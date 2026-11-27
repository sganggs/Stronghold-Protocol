// test/render/vfx-r86-f1.test.js — round 86 lane f1. Official hits the client was not playing:
// 煌 S3's channel hit on each cut target, 断崖 S2's hit on the enemy, 菲亚梅塔 S2's two projectiles (landing, mark,
// mark burst), 莫斯提马 S2 / 老鲤 S2 / 死芒 S2's cosmetic fxHit, 琴柳 S3's leftover projectile ids, 流形's split start
// and trail and the S3 refresh. With 官方特效 off, or the prefab missing, the procedural fx stays.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, bindingKeys, bindingEffects, skillPlan, bindList } from '../../public/js/render/vfx/skills.js';
import { fxSpec } from '../../public/js/render/fx/kinds.js';
import { UF } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = path.join(ROOT, 'public/assets/local/fx/index.json');
const HAS_INDEX = existsSync(INDEX);

const HUANG = 'huang_attack_01_hit';
const AYER = 'ayer_skill_02_hit_02';
const PH_HIT = 'phenxi_skill_02_hit';
const PH_BUFF = 'phenxi_skill_02_hit_buff';
const PH_END = 'phenxi_skill_02_hit_02';
const MOSTMA = 'mostma_skill_02_hit';
const LMLEE = 'lmlee_skill_02_debuff_hit';
const NECRAS = 'necras_skill_02_hit_01';
const SPLIT = 'token_10030_mlyss_wtrman_split_start_01';
const TRAIL = 'token_10030_mlyss_wtrman_split_trail_01';
const REFRESH = 'token_10030_mlyss_wtrman_refresh_01';
const PH_S2 = 'projectile_chr_phenxi_s2';
const PH_S2B = 'projectile_chr_phenxi_s2_2';
const SLEACH_S3B = 'projectile_chr_sleach_s3_2';
const WTR = 'projectile_chr_mlyss_wtrman';

const INSTALLED = [HUANG, AYER, PH_HIT, PH_BUFF, PH_END, MOSTMA, LMLEE, NECRAS, SPLIT, TRAIL, REFRESH];

const SKILLS = {
  char_017_huang: ['skchr_huang_3', 2],
  char_294_ayer: ['skchr_ayer_2', 1],
  char_300_phenxi: ['skchr_phenxi_2', 1],
  char_213_mostma: ['skchr_mostma_2', 1],
  char_322_lmlee: ['skchr_lmlee_2', 1],
  char_450_necras: ['skchr_necras_2', 1],
  token_10030_mlyss_wtrman: ['sktok_mlyss_wtrman_3', 0],
};

function emptySkill(projectiles = []) {
  return {
    rootClass: 'DurationSkill', effects: [], projectiles, abilities: [], uses: [], mode: 0,
  };
}

function makeIndex(installed = INSTALLED) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, { looping: k === PH_BUFF || k === TRAIL, spawn: 2 }]));
  const units = {};
  const skills = {};
  for (const [unitKey, [skillId]] of Object.entries(SKILLS)) {
    const skill = emptySkill(skillId === 'skchr_phenxi_2' ? [PH_S2, PH_S2B] : skillId === 'sktok_mlyss_wtrman_3' ? [WTR] : []);
    units[unitKey] = {
      kind: unitKey.startsWith('token') ? 'token' : 'char', talents: {}, startEffect: null, deadEffect: null,
      skills: { [skillId]: skill },
      modes: [{ name: 'Default', attack: null, combat: null }],
    };
    skills[skillId] = skill;
  }
  const s3 = emptySkill();
  units.char_300_phenxi.skills.skchr_phenxi_3 = s3;
  skills.skchr_phenxi_3 = s3;
  return {
    units, skills, prefabs, skins: {},
    generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] },
    projectiles: {
      [PH_S2]: { main: null, onReached: [PH_HIT], onHit: [], lifeTime: 10 },
      [PH_S2B]: { main: null, onReached: [PH_BUFF], onHit: [], onStop: [PH_END], lifeTime: 0.8 },
      [SLEACH_S3B]: { main: null, onReached: [], onHit: [], lifeTime: 1 },
      [WTR]: {
        main: TRAIL, onReached: [], onHit: [], lifeTime: 1,
        movement: { class: 'ParacurveMovement', speed: 4, raiseHeight: 0.8 },
        behaviours: [{ class: 'SimpleProjectile', node: WTR, fields: { _mainEffect: TRAIL, _lifeTime: 1 } }],
      },
      projectile_chr_tinman_s1: { main: null, onReached: ['tinman_skill_01_range_01'], onHit: [] },
    },
  };
}

function recordOf(info) {
  if (info.spine === 'char_300_phenxi' && info.skillIndex === 2) {
    return { charId: info.spine, skill: { skillId: 'skchr_phenxi_3', index: 2, skillType: 'MANUAL', duration: 15, bb: {} } };
  }
  const row = SKILLS[info.spine];
  if (!row) return null;
  return { charId: info.spine, skill: { skillId: row[0], index: row[1], skillType: 'MANUAL', duration: 15, bb: {} } };
}

async function setup({ installed = INSTALLED, active = true } = {}) {
  const index = makeIndex(installed);
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [], ctx: {},
    lib: {
      has: (k) => !!index.prefabs[k],
      def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: index.prefabs[k].spawn } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = {
        key, place, opts, time: 0, stopped: null,
        get alive() { return !this.stopped; }, stop(o = {}) { this.stopped = o; }, kill() { this.stopped = { killed: true }; },
      };
      handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: recordOf, view: (id) => views.get(id) || null });
  await w.ready();
  let n = 1;
  const add = (spine, x, y, extra = {}) => {
    const id = extra.id ?? n++;
    const skillIndex = extra.skillIndex ?? SKILLS[spine]?.[1] ?? 0;
    const v = {
      id, x, y, z: 0, visFacing: 1, isEnemy: !!extra.enemy, alive: true, flags: 0, dir: 'RIGHT',
      info: { id, spine, defId: spine, side: extra.enemy ? 'enemy' : 'ally', kind: extra.enemy ? 'enemy' : spine.startsWith('token') ? 'token' : 'op', skillIndex },
    };
    views.set(id, v);
    return v;
  };
  const cast = {};
  cast.huang = add('char_017_huang', 3, 10);
  cast.foeA = add('enemy_a', 4, 10, { enemy: true });
  cast.foeB = add('enemy_b', 3, 11, { enemy: true });
  cast.ayer = add('char_294_ayer', 3, 9);
  cast.phenxi = add('char_300_phenxi', 2, 10);
  cast.phenxi3 = add('char_300_phenxi', 2, 8, { skillIndex: 2 });
  cast.mostma = add('char_213_mostma', 5, 10);
  cast.lmlee = add('char_322_lmlee', 6, 10);
  cast.necras = add('char_450_necras', 7, 10);
  cast.origin = add('token_10030_mlyss_wtrman', 8, 10);
  cast.clone = add('token_10030_mlyss_wtrman', 9, 10);
  cast.mark = add('enemy_c', 6, 11, { enemy: true });
  await w.begin([...views.values()]);
  w.sync(views.values());
  return { w, ofx, handles, cast };
}

const arm = (w, v) => { v.flags |= UF.SKILL; w.skill(v, true); };
const keysOf = (handles, from) => handles.slice(from).map((h) => h.key);

describe('round 86 lane f1 bindings', () => {
  test('fxHit draws nothing, cases keep an owner, and projectile ids are preloaded only when the binding names keys', () => {
    assert.equal(fxSpec('fxHit').a, 'none');
    for (const kinds of Object.values(FX_BINDINGS)) for (const b of Object.values(kinds)) assert.ok(['id', 'src', 'skill', 'token'].includes(b.owner), b.owner); // 'token': 机械师 S3's charge (round 86 f5)
    const aoe = FX_BINDINGS.skchr_phenxi_2.aoe;
    assert.equal(bindList(aoe).length, 2);
    assert.deepEqual(bindList(aoe).map((b) => b.tag), ['phenxi:s2', 'phenxi:mark']);
    assert.equal(aoe.owner, 'id');
    const idx = makeIndex();
    const phenxi = bindingKeys(idx, 'skchr_phenxi_2').sort();
    for (const k of [PH_HIT, PH_END, PH_BUFF, PH_S2, PH_S2B]) assert.ok(phenxi.includes(k), k);
    const sleach = bindingKeys(idx, 'skchr_sleach_3');
    assert.ok(sleach.includes(SLEACH_S3B));
    assert.ok(sleach.includes('sleach_buff_01'));
    assert.equal(sleach.includes('projectile_chr_sleach_t1_2'), false);
    const wtr = bindingKeys(idx, 'sktok_mlyss_wtrman_3');
    assert.ok(wtr.includes(WTR) && wtr.includes(SPLIT) && wtr.includes(TRAIL) && wtr.includes(REFRESH));
    const tin = bindingKeys(idx, 'skchr_tinman_1');
    assert.equal(tin.includes('projectile_chr_tinman_s1'), false, 'a binding without keys does not gain its projectile id');
    assert.ok(tin.includes('tinman_skill_01_hit_01') && tin.includes('tinman_skill_01_range_01'));
    assert.equal(FX_BINDINGS.skchr_tinman_2.zone.claim, true);
  });

  test('煌\'s cut plays the hit on each named enemy; the finish burst and a missing prefab stay procedural', async () => {
    const { w, handles, cast } = await setup();
    arm(w, cast.huang);
    const at = handles.length;
    assert.equal(w.simFx('aoe', cast.huang.x, cast.huang.y, { id: cast.huang.id, skill: 'huang:cut', radius: 0.6, targets: [cast.foeA.id, cast.foeB.id] }), true);
    assert.deepEqual(keysOf(handles, at), [HUANG, HUANG]);
    assert.deepEqual(handles.slice(at).map((h) => h.opts.owner.id), [cast.foeA.id, cast.foeB.id]);
    const burst = handles.length;
    assert.equal(w.simFx('aoe', cast.huang.x, cast.huang.y, { id: cast.huang.id, skill: 'huang:burst', radius: 1.5 }), false);
    assert.equal(handles.length, burst);
    const bare = await setup({ installed: INSTALLED.filter((k) => k !== HUANG) });
    arm(bare.w, bare.cast.huang);
    assert.equal(bare.w.simFx('aoe', 3, 10, { id: bare.cast.huang.id, skill: 'huang:cut', targets: [bare.cast.foeA.id] }), false);
    assert.equal(bare.handles.length, 0);
    const off = await setup({ active: false });
    arm(off.w, off.cast.huang);
    assert.equal(off.w.simFx('aoe', 3, 10, { id: off.cast.huang.id, skill: 'huang:cut', targets: [off.cast.foeA.id] }), false);
    assert.equal(off.handles.length, 0);
  });

  test('断崖\'s strike plays on the enemy she hit, and only while the skill lasts', async () => {
    const { w, handles, cast } = await setup();
    const idle = handles.length;
    assert.equal(w.simFx('strike', cast.foeA.x, cast.foeA.y, { id: cast.foeA.id, src: cast.ayer.id, skill: 'ayer_2' }), false);
    arm(w, cast.ayer);
    assert.equal(w.simFx('strike', cast.foeA.x, cast.foeA.y, { id: cast.foeA.id, src: cast.ayer.id, skill: 'ayer_2' }), true);
    assert.deepEqual(keysOf(handles, idle), [AYER]);
    assert.equal(handles.at(-1).opts.owner.id, cast.foeA.id);
    assert.equal(w.simFx('strike', cast.foeA.x, cast.foeA.y, { id: cast.foeA.id, src: cast.ayer.id, skill: 'other' }), false);
  });

  test('菲亚梅塔 S2 plays the landing, the mark and the mark burst; S3\'s aoe is not taken', async () => {
    const { w, handles, cast } = await setup();
    const a = handles.length;
    assert.equal(w.simFx('aoe', 4, 10, { id: cast.phenxi.id, skill: 'phenxi:s2' }), true);
    assert.deepEqual(keysOf(handles, a), [PH_HIT]);
    const z = handles.length;
    assert.equal(w.simFx('zone', 4, 11, { id: cast.phenxi.id, skill: 'phenxi:mark', dur: 0.8 }), true);
    assert.deepEqual(keysOf(handles, z), [PH_BUFF]);
    assert.equal(handles.at(-1).opts.loop, true);
    const b = handles.length;
    assert.equal(w.simFx('aoe', 4, 11, { id: cast.phenxi.id, skill: 'phenxi:mark' }), true);
    assert.deepEqual(keysOf(handles, b), [PH_END]);
    const s3 = handles.length;
    assert.equal(w.simFx('aoe', 4, 12, { id: cast.phenxi.id, skill: 'phenxi:s3' }), false);
    assert.equal(w.simFx('aoe', 4, 12, { id: cast.phenxi3.id, skill: 'phenxi:s3' }), false);
    assert.equal(handles.length, s3);
    const off = await setup({ active: false });
    assert.equal(off.w.simFx('aoe', 4, 10, { id: off.cast.phenxi.id, skill: 'phenxi:s2' }), false);
    assert.equal(off.handles.length, 0);
  });

  test('莫斯提马, 老鲤 and 死芒 play fxHit on the enemy the kit names', async () => {
    const { w, handles, cast } = await setup();
    assert.equal(w.simFx('fxHit', 5, 11, { id: cast.mostma.id, target: cast.foeA.id, skill: 'mostma:s2' }), false, 'the channel hit is only while the skill lasts');
    arm(w, cast.mostma);
    const m = handles.length;
    assert.equal(w.simFx('fxHit', cast.foeA.x, cast.foeA.y, { id: cast.mostma.id, target: cast.foeA.id, skill: 'mostma:s2' }), true);
    assert.deepEqual(keysOf(handles, m), [MOSTMA]);
    assert.equal(handles.at(-1).opts.owner.id, cast.foeA.id);
    assert.equal(w.simFx('zone', cast.mostma.x, cast.mostma.y, { id: cast.mostma.id, duration: 10 }), false, 'the range zone is not this hit');
    const paper = handles.length;
    assert.equal(w.simFx('fxHit', cast.mark.x, cast.mark.y, { id: cast.lmlee.id, target: cast.mark.id, skill: 'lmlee:paper' }), true);
    assert.deepEqual(keysOf(handles, paper), [LMLEE]);
    assert.equal(handles.at(-1).opts.owner.id, cast.mark.id);
    assert.equal(w.simFx('mark', cast.mark.x, cast.mark.y, { id: cast.mark.id, src: cast.lmlee.id, skill: 'lmlee_2' }), false);
    assert.equal(w.simFx('explode', cast.mark.x, cast.mark.y, { id: cast.lmlee.id, skill: 'lmlee_2' }), false);
    arm(w, cast.necras);
    const ne = handles.length;
    assert.equal(w.simFx('fxHit', cast.foeB.x, cast.foeB.y, { id: cast.necras.id, target: cast.foeB.id, skill: 'necras:s2' }), true);
    assert.deepEqual(keysOf(handles, ne), [NECRAS]);
    assert.equal(w.simFx('sleep', cast.foeB.x, cast.foeB.y, { id: cast.foeB.id }), false, 'the untagged sleep is not the tick');
    const off = await setup({ active: false });
    arm(off.w, off.cast.mostma);
    assert.equal(off.w.simFx('fxHit', 4, 10, { id: off.cast.mostma.id, target: off.cast.foeA.id, skill: 'mostma:s2' }), false);
    assert.equal(off.w.simFx('fxHit', 6, 11, { id: off.cast.lmlee.id, target: off.cast.mark.id, skill: 'lmlee:paper' }), false);
    assert.equal(off.handles.length, 0);
  });

  test('流形\'s split plays the start at the clone and flies the trail from the origin; the refresh is the living token', async () => {
    const { w, handles, cast } = await setup();
    const s = handles.length;
    assert.equal(w.simFx('split', cast.clone.x, cast.clone.y, { id: cast.clone.id, src: cast.origin.id }), true);
    assert.ok(keysOf(handles, s).includes(SPLIT));
    assert.ok(keysOf(handles, s).includes(TRAIL), 'the projectile trail leaves with the start');
    const m = handles.length;
    assert.equal(w.simFx('manifoldSplit', cast.clone.x, cast.clone.y, { id: cast.clone.id, from: cast.origin.id, src: cast.origin.id }), true);
    assert.ok(keysOf(handles, m).includes(SPLIT) && keysOf(handles, m).includes(TRAIL));
    const r = handles.length;
    assert.equal(w.simFx('fxHit', cast.clone.x, cast.clone.y, { id: cast.clone.id, skill: 'mlyss:refresh' }), true);
    assert.deepEqual(keysOf(handles, r), [REFRESH]);
    assert.equal(w.simFx('fxHit', cast.clone.x, cast.clone.y, { id: cast.clone.id, skill: 'other' }), false);
    const off = await setup({ active: false });
    assert.equal(off.w.simFx('split', 9, 10, { id: off.cast.clone.id, src: off.cast.origin.id }), false);
    assert.equal(off.handles.length, 0);
  });
});

describe('the extracted index (when fx is on this machine)', { skip: !HAS_INDEX && 'no public/assets/local/fx/index.json' }, () => {
  const idx = HAS_INDEX ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;
  const plan = (unit, sid) => skillPlan(idx, unit, sid, { rec: { skillId: sid, duration: 10, bb: {} } });
  const reasons = (p, key) => p.unmapped.filter((u) => u.key === key).map((u) => u.reason);

  function idleProjectiles(skillId, p) {
    const bound = new Set(bindingKeys(idx, skillId));
    const idle = [];
    if (!(p.projectiles || []).length || (p.attacks || []).length !== 0) return idle;
    for (const pk of p.projectiles) {
      const proj = idx.projectiles?.[pk];
      const keys = [pk, proj?.main, ...(Array.isArray(proj?.onReached) ? proj.onReached : []), ...(Array.isArray(proj?.onHit) ? proj.onHit : [])]
        .map((k) => (typeof k === 'string' ? k.toLowerCase() : '')).filter(Boolean);
      if (keys.some((k) => bound.has(k))) continue;
      idle.push(pk);
    }
    return idle;
  }

  test('claimed rows are bound, and the rows this lane left stay their old reason', () => {
    assert.deepEqual(reasons(plan('char_017_huang', 'skchr_huang_3'), HUANG), ['bound']);
    // §37.360: 星熊 S3 now cuts once a second and its fxHit binding claims the channel hit
    assert.deepEqual(reasons(plan('char_136_hsguma', 'skchr_hsguma_3'), 'hsguma_skill_03_hit'), ['bound']);
    assert.ok(reasons(plan('char_206_gnosis', 'skchr_gnosis_2'), 'gnosis_skill_02_buff_01').includes('conditional'));
    assert.ok(reasons(plan('char_206_gnosis', 'skchr_gnosis_2'), 'gnosis_skill_02_buff_02').includes('conditional'));
    assert.deepEqual(reasons(plan('char_213_mostma', 'skchr_mostma_2'), MOSTMA), ['bound']);
    assert.ok(reasons(plan('char_249_mlyss', 'skchr_mlyss_3'), 'token_10030_mlyss_wtrman_c2_skill_03_buff_01').includes('conditional'));
    assert.deepEqual(reasons(plan('char_294_ayer', 'skchr_ayer_2'), AYER), ['bound']);
    // round 87 h1 claims zebra_buff_01: the S1 hit already selects that ally
    const zebra = reasons(plan('char_304_zebra', 'skchr_zebra_1'), 'zebra_buff_01');
    assert.ok(zebra.length > 0 && zebra.every((r) => r === 'bound'));
    assert.deepEqual(reasons(plan('char_322_lmlee', 'skchr_lmlee_2'), LMLEE), ['bound']);
    assert.ok(reasons(plan('char_340_shwaz', 'skchr_shwaz_1'), 'buff_defdown').includes('conditional'));
    assert.ok(reasons(plan('char_427_vigil', 'skchr_vigil_2'), 'vigil_token_skill_02_ready').includes('token'));
    assert.deepEqual(reasons(plan('char_450_necras', 'skchr_necras_2'), NECRAS), ['bound']);
    const tok = plan('token_10030_mlyss_wtrman', 'sktok_mlyss_wtrman_3');
    assert.deepEqual(reasons(tok, REFRESH), ['bound']);
    assert.ok(reasons(tok, SPLIT).includes('bound'));
    assert.ok(reasons(tok, 'token_10030_mlyss_wtrman_c3_to_c0').includes('token'));
    assert.equal(reasons(tok, 'token_10030_mlyss_wtrman_c3_to_c0').includes('bound'), false);
    const tinUnit = Object.keys(idx.units).find((k) => idx.units[k]?.skills?.skchr_tinman_2);
    assert.ok(tinUnit);
    const tinReasons = reasons(plan(tinUnit, 'skchr_tinman_2'), 'tinman_skill_02_hit_01');
    assert.ok(tinReasons.length > 0 && tinReasons.every((r) => r === 'bound'));
  });

  test('projectile rows the bindings play are no longer idle, and 琴柳\'s effect-less t1_2 stays', () => {
    assert.deepEqual(idleProjectiles('skchr_phenxi_2', plan('char_300_phenxi', 'skchr_phenxi_2')), []);
    const sleach = idleProjectiles('skchr_sleach_3', plan('char_479_sleach', 'skchr_sleach_3'));
    assert.deepEqual(sleach, ['projectile_chr_sleach_t1_2']);
    assert.deepEqual(idleProjectiles('sktok_mlyss_wtrman_3', plan('token_10030_mlyss_wtrman', 'sktok_mlyss_wtrman_3')), []);
    for (const k of bindingEffects(idx, FX_BINDINGS.skchr_huang_3.aoe)) assert.ok(idx.prefabs[k], k);
    for (const b of bindList(FX_BINDINGS.skchr_phenxi_2.aoe)) for (const k of bindingEffects(idx, b)) assert.ok(idx.prefabs[k], k);
    assert.ok(idx.prefabs[idx.projectiles[WTR].main]);
  });
});
