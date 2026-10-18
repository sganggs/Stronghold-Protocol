// test/render/vfx-procedural.test.js — when the official layer stands for the field view's procedural looks (the 0.3.0
// official-effects audit R10 / R11, history §32.14.44, DESIGN §33.13): a skill whose official plan has no cast rows shows
// no procedural burst; a kit fx is skipped while a skill that covers it lasts (FX_COVER), bound to the official prefab
// the client plays there (FX_BINDINGS `during`, `hold: 'fx'`, `keys`, owner 'skill'), or repeated by a summon's official
// birth effect — and every procedural look stays with 官方特效 off or the effects not installed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { COVER_AFTER_S } from '../../public/js/render/vfx/skillfx.js';
import { FX_BINDINGS, FX_COVER, BOUND_BY_SKILL, coverOf, bindingEffects, bindingKeys } from '../../public/js/render/vfx/skills.js';

const LOOPING = new Set(['tinman_skill_01_range_01', 'tinman_skill_01_token_01', 'mostma_skill_02_buff']);
const KEYS = ['quiet_hit', 'silent_attack_01_trail', 'tinman_attack_hit_01', 'tinman_skill_01_start_03', 'tinman_skill_01_range_01', 'tinman_skill_01_token_01',
  'tinman_skill_01_start_01', 'mostma_skill_02_buff', 'reed2_attack_hit', 'reed2_skill_02_hit', 'g_birth', 'tok_birth', 'g_hit'];

function makeIndex({ installed = KEYS } = {}) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k) }]));
  const mode = (hit) => [{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [{ effects: [hit], directionType: 0 }] } }];
  const unit = (modes, skills, o = {}) => ({ kind: 'char', modes, skills, startEffect: null, deadEffect: null, ...o });
  return {
    units: {
      // no rows at all for its skill (银灰 S1): only its attack's hit is installed
      char_700_quiet: unit(mode('quiet_hit'), { skchr_quiet_1: { mode: null, projectiles: [], uses: [] } }),
      // a passive with no rows (普罗旺斯 S1): the sim opens its 0.5 s skill window at deploy, the client shows nothing
      char_701_passive: unit(mode('quiet_hit'), { skchr_passive_1: { mode: null, projectiles: [], uses: [] } }),
      // 赫默 S2 (CastTokenSkill, no rows): her attack is a projectile's — the unit's refs name its prefabs
      char_108_silent: unit([{ name: 'Default', attack: { class: 'RangedHeal', projectileKey: 'projectile_silent' } }], { skchr_silent_2: { mode: null, projectiles: [], uses: [] } }, { refs: ['silent_attack_01_trail'] }),
      char_4151_tinman: unit(mode('tinman_attack_hit_01'), { skchr_tinman_1: { mode: null, projectiles: ['projectile_chr_tinman_s1'], uses: [
        { role: 'loop', keys: ['tinman_skill_01_start_03'], from: 'UberEffectEmitter._castEffects', node: 'skchr_tinman_1', ability: 'RangedAttack', startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: false, list: 'cast', projectileKey: 'projectile_chr_tinman_s1' },
      ] } }),
      char_213_mostma: unit(mode('g_hit'), { skchr_mostma_2: { mode: null, projectiles: [], uses: [
        { role: 'loop', keys: ['mostma_skill_02_buff'], from: 'BuffDuringSkill._buffs', node: 'sk', on: 'owner' },
      ] } }),
      char_1020_reed2: unit(mode('reed2_attack_hit'), { skchr_reed2_2: { mode: null, projectiles: ['projectile_chr_reed2_fire'], uses: [] } }),
      char_900_carrier: unit(mode('g_hit'), {}),
      token_1_own: unit(mode('g_hit'), {}, { kind: 'token', startEffect: 'tok_birth' }),
      token_2_plain: unit(mode('g_hit'), {}, { kind: 'token' }),
      enemy_1: { kind: 'enemy', modes: mode('g_hit'), skills: {} },
    },
    skills: {},
    projectiles: {
      projectile_chr_tinman_s1: { main: 'tinman_skill_01_trail_01', onReached: ['tinman_skill_01_range_01', 'tinman_skill_01_start_01', 'tinman_skill_01_token_01'], effects: [] },
      projectile_chr_reed2_fire: { main: null, onHit: ['reed2_skill_02_hit'], effects: [] },
    },
    skins: {},
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_hit', heal: 'g_hit' }, die: {}, birth: { char: 'g_birth' }, status: {} },
    prefabs,
  };
}

const rec = (skillId, o = {}) => ({ skill: { skillId, index: 0, skillType: 'MANUAL', durationType: 'NONE', duration: 0, bb: {}, ...o } });
const RECS = {
  char_700_quiet: rec('skchr_quiet_1'),
  char_701_passive: rec('skchr_passive_1', { skillType: 'PASSIVE' }),
  char_108_silent: rec('skchr_silent_2'),
  char_4151_tinman: rec('skchr_tinman_1'),
  char_213_mostma: rec('skchr_mostma_2', { duration: 20 }),
  char_1020_reed2: rec('skchr_reed2_2', { duration: 20 }),
};

async function setup({ active = true, installed } = {}) {
  const index = makeIndex({ installed });
  const spawned = [];
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [],
    lib: {
      has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 2 } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = { key, place, opts, stopped: false, get alive() { return !this.stopped; }, stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      spawned.push(key); handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: (info) => RECS[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, x, y = 10) => {
    const enemy = /^enemy_/.test(key);
    const v = { id, x, y, z: 0, visFacing: 1, isEnemy: enemy, alive: true, flags: 0, sp: 0, spMax: 10, dir: enemy ? undefined : 'RIGHT',
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind: enemy ? 'enemy' : /^token_/.test(key) ? 'token' : 'op', skillIndex: 0 } };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); ofx.time += dt; };
  return { w, ofx, views, view, frame, spawned, handles, index };
}

const live = (handles, key) => handles.filter((h) => h.key === key && h.alive);

describe('R10: a skill whose official plan has no cast rows shows no procedural burst', () => {
  test('with the unit\'s effects installed the official layer stands for the cast (render/app.js skips fx.skill)', async () => {
    const { w, view, frame, spawned } = await setup();
    const u = view(1, 'char_700_quiet', 5);
    frame();
    assert.equal(w.skill(u, true), true);
    assert.equal(spawned.length, 0, 'and plays nothing: the client shows nothing there');
  });

  test('a unit whose attack is a projectile\'s (赫默 S2): its referenced prefabs show its effects are installed', async () => {
    const { w, view, frame } = await setup();
    const u = view(1, 'char_108_silent', 5);
    frame();
    assert.equal(w.skill(u, true), true);
    const lite = await setup({ installed: KEYS.filter((k) => k !== 'silent_attack_01_trail') });
    const v = lite.view(1, 'char_108_silent', 5);
    lite.frame();
    assert.equal(lite.w.skill(v, true), false);
  });

  test('a lite install without the unit\'s effects, and the layer off, keep the procedural burst', async () => {
    const lite = await setup({ installed: KEYS.filter((k) => k !== 'quiet_hit') });
    const a = lite.view(1, 'char_700_quiet', 5);
    lite.frame();
    assert.equal(lite.w.skill(a, true), false);
    const off = await setup({ active: false });
    const b = off.view(1, 'char_700_quiet', 5);
    off.frame();
    assert.equal(off.w.skill(b, true), false);
  });
});

describe('R10 for a passive skill (0.3.1): its skill window at deploy shows no procedural burst either', () => {
  test('nothing official to draw and the unit\'s effects installed: the official layer stands for it', async () => {
    const { w, view, frame, spawned } = await setup();
    const u = view(1, 'char_701_passive', 5);
    frame();
    assert.equal(w.skill(u, true), true);
    assert.equal(spawned.length, 0);
  });

  test('a lite install without the unit\'s effects, and the layer off, keep the procedural burst', async () => {
    const lite = await setup({ installed: KEYS.filter((k) => k !== 'quiet_hit') });
    const a = lite.view(1, 'char_701_passive', 5);
    lite.frame();
    assert.equal(lite.w.skill(a, true), false);
    const off = await setup({ active: false });
    const b = off.view(1, 'char_701_passive', 5);
    off.frame();
    assert.equal(off.w.skill(b, true), false);
  });
});

describe('R11: FX_COVER — a kind the skill\'s official effects stand for', () => {
  test('莫斯提马 S2\'s zone is skipped while the skill lasts and COVER_AFTER_S after, drawn again later', async () => {
    const { w, ofx, view, frame } = await setup();
    const m = view(1, 'char_213_mostma', 5);
    frame();
    w.skill(m, true);
    assert.equal(w.simFx('zone', 5, 10, { id: 1, duration: 20 }), true, 'during the skill');
    frame();
    w.skill(m, false);
    ofx.time += COVER_AFTER_S / 2;
    assert.equal(w.simFx('zone', 5, 10, { id: 1 }), true, 'a moment after its end');
    ofx.time += COVER_AFTER_S;
    frame();
    assert.equal(w.simFx('zone', 5, 10, { id: 1 }), false, 'not the skill\'s any more');
    assert.equal(w.simFx('ripple', 5, 10, { id: 1 }), false, 'a kind it does not cover');
  });

  test('not covered with the skill\'s effects not installed or the layer off', async () => {
    const lite = await setup({ installed: KEYS.filter((k) => k !== 'mostma_skill_02_buff') });
    const a = lite.view(1, 'char_213_mostma', 5);
    lite.frame();
    lite.w.skill(a, true);
    assert.equal(lite.w.simFx('zone', 5, 10, { id: 1 }), false);
    const off = await setup({ active: false });
    const b = off.view(1, 'char_213_mostma', 5);
    off.frame();
    off.w.skill(b, true);
    assert.equal(off.w.simFx('zone', 5, 10, { id: 1 }), false);
  });

  test('the table: R11\'s cases, src before id, a kind lookup', () => {
    assert.ok(coverOf('skchr_mostma_2', 'zone'));
    assert.ok(coverOf('SKCHR_ARCHET_1', 'volley'));
    assert.equal(coverOf('skchr_mostma_2', 'displace'), false, 'a displacement stays (a game fact)');
    assert.equal(coverOf(null, 'zone'), false);
    for (const [sid, kinds] of Object.entries(FX_COVER)) {
      assert.ok(Array.isArray(kinds) && kinds.length, sid);
      for (const k of kinds) assert.ok(!['drone', 'drones', 'droneLock', 'overload'].includes(k), `${sid}: the floating units decide ${k}`);
    }
  });
});

describe('R11: FX_BINDINGS — the official prefab the client plays at the kit fx', () => {
  test('锡人 S1\'s zone plays the flask\'s reached effects at its tile, held for the zone\'s own time; outside the skill it is not bound', async () => {
    const { w, ofx, view, frame, spawned, handles } = await setup();
    const t = view(1, 'char_4151_tinman', 4);
    frame();
    w.skill(t, true);
    assert.equal(w.simFx('zone', 5, 11.29, { radius: 1, dur: 3, id: 1, skill: 'tinman1' }), true);
    w.skill(t, false);
    for (const k of ['tinman_skill_01_range_01', 'tinman_skill_01_start_01', 'tinman_skill_01_token_01']) assert.ok(spawned.includes(k), k);
    assert.equal(live(handles, 'tinman_skill_01_range_01').length, 1);
    assert.equal(handles.find((x) => x.key === 'tinman_skill_01_range_01').opts.important, true, 'never dropped while the area lasts');
    for (let i = 0; i < 2.5 * 30; i++) frame();
    assert.equal(live(handles, 'tinman_skill_01_range_01').length, 1, 'still there at 2.5 s');
    for (let i = 0; i < 0.6 * 30; i++) frame();
    assert.equal(live(handles, 'tinman_skill_01_range_01').length, 0, 'gone after the zone\'s 3 s');
    ofx.time += 5;
    frame();
    const n = spawned.length;
    assert.equal(w.simFx('zone', 5, 11, { radius: 1, dur: 3, id: 1 }), false, 'a zone outside the skill is not the skill\'s');
    assert.equal(spawned.length, n);
  });

  test('none of the binding\'s prefabs installed: the procedural zone stays', async () => {
    const { w, view, frame } = await setup({ installed: KEYS.filter((k) => !/^tinman_skill_01_(range|start_01|token)/.test(k)) });
    const t = view(1, 'char_4151_tinman', 4);
    frame();
    w.skill(t, true);
    assert.equal(w.simFx('zone', 5, 11, { dur: 8, id: 1 }), false);
  });

  test('焰影苇草 S2: a strike from a carrier (owner \'skill\') plays the fireball\'s hit on the enemy while her skill lasts', async () => {
    const { w, view, frame, handles } = await setup();
    const r = view(1, 'char_1020_reed2', 4);
    view(2, 'char_900_carrier', 5);
    const e = view(3, 'enemy_1', 7);
    frame();
    assert.equal(w.simFx('strike', 7, 10, { id: 3, src: 2 }), false, 'not before her skill');
    w.skill(r, true);
    assert.equal(w.simFx('strike', 7, 10, { id: 3, src: 2 }), true);
    assert.ok(handles.some((x) => x.key === 'reed2_skill_02_hit'), 'the official hit');
    e.alive = false;
  });

  test('the table: owner fields, keys, the owner-less kinds, preloading', () => {
    const idx = makeIndex();
    assert.equal(FX_BINDINGS.skchr_tinman_1.zone.hold, 'fx');
    assert.equal(FX_BINDINGS.skchr_lemuen_3.lock.owner, 'src');
    assert.deepEqual(bindingEffects(idx, FX_BINDINGS.skchr_pasngr_3.lightning), ['pasngr_skill_03_hit'], 'explicit keys');
    assert.deepEqual(BOUND_BY_SKILL.strike, ['skchr_reed2_2']);
    assert.deepEqual(bindingKeys(idx, 'skchr_tinman_1').sort(), ['tinman_skill_01_range_01', 'tinman_skill_01_start_01', 'tinman_skill_01_token_01']);
    for (const kinds of Object.values(FX_BINDINGS)) for (const b of Object.values(kinds)) assert.ok(['id', 'src', 'skill'].includes(b.owner));
  });
});

describe('R11: a summon\'s arrival repeats its official birth effect', () => {
  test('the summon pillar in the deploy\'s frame is skipped; the arrival burst only with the token\'s own birth effect', async () => {
    const { w, view, frame } = await setup();
    const a = view(5, 'token_1_own', 6);
    const b = view(6, 'token_2_plain', 7);
    frame();
    w.deploy(a);
    w.deploy(b);
    assert.equal(w.simFx('summon', 6, 10, { id: 5, token: 'token_1_own' }), true);
    assert.equal(w.simFx('summon', 7, 10, { id: 6, token: 'token_2_plain' }), true, 'the generic birth is drawn too');
    assert.equal(w.simFx('summonStun', 6, 10, { id: 5, token: 'token_1_own', n: 1 }), true, 'its own birth effect is its arrival');
    assert.equal(w.simFx('summonBurst', 7, 10, { id: 6, token: 'token_2_plain', n: 1 }), false, 'the generic birth is no burst');
    assert.equal(w.simFx('drones', 6, 10, { id: 5, n: 1 }), false, 'the floating units decide theirs');
    frame();
    assert.equal(w.simFx('summon', 6, 10, { id: 5 }), false, 'a later frame: no birth to repeat');
  });

  test('without the birth effect installed, or with the layer off, the pillar stays', async () => {
    const lite = await setup({ installed: KEYS.filter((k) => k !== 'g_birth') });
    const a = lite.view(6, 'token_2_plain', 7);
    lite.frame();
    lite.w.deploy(a);
    assert.equal(lite.w.simFx('summon', 7, 10, { id: 6 }), false);
    const off = await setup({ active: false });
    const b = off.view(6, 'token_2_plain', 7);
    off.frame();
    off.w.deploy(b);
    assert.equal(off.w.simFx('summon', 7, 10, { id: 6 }), false);
  });
});
