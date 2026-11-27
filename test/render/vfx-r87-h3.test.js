// test/render/vfx-r87-h3.test.js — round 87 lane h3: 锋盔 / 泰特斯 hit and 假想敌：铳 chain hit.
// Synthetic index for playback. The extracted index is read only when it is present (GitHub CI has no art pack).
// With 官方特效 off the procedural layer is not claimed and nothing here is spawned.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { ENEMY_FX_BINDINGS, skillPlan } from '../../public/js/render/vfx/skills.js';
import { auditSkill } from '../../tools/vfx-missing-fx.mjs';
import { fxSpec } from '../../public/js/render/fx/kinds.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = path.join(ROOT, 'public/assets/local/fx/index.json');
const HAS_INDEX = existsSync(INDEX);

const HIT = 'enemy_lfkght_skill_01_hit';
const CHAIN = 'enemy_achunt_chain_hit';

function makeIndex({ installed = [HIT, CHAIN] } = {}) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, {
    file: `prefabs/${k}.json`, looping: false, spawn: k === HIT ? 1 : 2,
  }]));
  const enemy = () => ({ kind: 'enemy', modes: [{ name: 'Default', attack: null, combat: null }], skills: {}, talents: {} });
  return {
    units: {
      enemy_1104_lfkght: enemy(),
      enemy_1104_lfkght_3: enemy(),
      enemy_9017_achunt: enemy(),
      enemy_9017_achunt_2: enemy(),
      enemy_1512_mcmstr: enemy(),
      char_test: { kind: 'char', modes: [], skills: {}, startEffect: null, deadEffect: null },
    },
    skills: {},
    projectiles: {},
    skins: {},
    generic: { hit: {}, die: {}, birth: {}, status: {} },
    prefabs,
  };
}

async function setup({ active = true, installed } = {}) {
  const index = makeIndex({ installed });
  const spawned = [];
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [], ctx: {},
    lib: {
      has: (k) => !!index.prefabs[k],
      def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: index.prefabs[k].spawn ?? 2 } : null),
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
  const w = new FxWiring(ofx, { speed: () => 10, record: () => null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, x, y = 9, o = {}) => {
    const isEnemy = /^enemy_/.test(key);
    const v = {
      id, x, y, z: 0, visFacing: 1, isEnemy, alive: o.alive !== false, flags: 0, sp: 0, spMax: 10,
      info: { id, spine: key, defId: key, side: isEnemy ? 'enemy' : 'ally', kind: isEnemy ? 'enemy' : 'op' },
    };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); ofx.time += dt; };
  return { w, ofx, view, frame, spawned, handles };
}

const count = (spawned, key) => spawned.filter((k) => k === key).length;

describe('round 87 h3 enemy hits', () => {
  test('锋盔 and 泰特斯 play the weaken hit on the named ally, and only that ally', async () => {
    const { w, view, frame, spawned, handles } = await setup();
    const apprentice = view(1, 'enemy_1104_lfkght', 2);
    const titus = view(2, 'enemy_1104_lfkght_3', 4);
    const hit = view(3, 'char_test', 8, 9);
    const other = view(4, 'char_test', 10, 9);
    frame();
    assert.equal(fxSpec('lfkghtHit').a, 'none');
    assert.equal(w.simFx('lfkghtHit', hit.x, hit.y, { id: apprentice.id, target: hit.id }), true);
    assert.equal(count(spawned, HIT), 1);
    assert.equal(handles.find((h) => h.key === HIT).opts.owner, hit);
    assert.equal(handles.find((h) => h.key === HIT).opts.loop, false);
    assert.equal(w.simFx('lfkghtHit', other.x, other.y, { id: titus.id, target: other.id }), true);
    assert.equal(count(spawned, HIT), 2);
    assert.equal(handles.filter((h) => h.key === HIT)[1].opts.owner, other);
    assert.equal(w.simFx('lfkghtHit', hit.x, hit.y, { id: apprentice.id, target: other.id }), true);
    assert.equal(count(spawned, HIT), 3, 'each cast plays the one-shot again');
    const ugly = view(5, 'enemy_1512_mcmstr', 1);
    frame();
    assert.equal(w.simFx('lfkghtHit', hit.x, hit.y, { id: ugly.id, target: hit.id }), false, 'another enemy does not own this hit');
    assert.equal(count(spawned, HIT), 3);
    assert.equal(w.simFx('explode', 4, 9, { kind: 'mechBomb', id: ugly.id }), false);
    assert.equal(w.simFx('beam', apprentice.x, apprentice.y, { from: apprentice.id, to: hit.id, kind: 'fearCage' }), false);
    assert.equal(w.simFx('phase', titus.x, titus.y, { id: titus.id, kind: 'shotDown' }), false);
    assert.equal(count(spawned, HIT), 3);
    assert.equal(count(spawned, CHAIN), 0);
  });

  test('a dead ally or a missing target does not claim the weaken hit', async () => {
    const { w, view, frame, spawned } = await setup();
    const apprentice = view(1, 'enemy_1104_lfkght', 2);
    const dead = view(3, 'char_test', 8, 9, { alive: false });
    frame();
    assert.equal(w.simFx('lfkghtHit', dead.x, dead.y, { id: apprentice.id, target: dead.id }), false);
    assert.equal(w.simFx('lfkghtHit', apprentice.x, apprentice.y, { id: apprentice.id }), false);
    assert.equal(count(spawned, HIT), 0);
  });

  test('隐秘铳 plays the chain hit on the named operator; the beam and the base gun do not', async () => {
    const { w, view, frame, spawned, handles } = await setup();
    const gun = view(1, 'enemy_9017_achunt_2', 2);
    const base = view(2, 'enemy_9017_achunt', 3);
    const spring = view(3, 'enemy_9020_actrpc', 6);
    const op = view(4, 'char_test', 4, 9);
    const bystander = view(5, 'char_test', 12, 9);
    frame();
    assert.equal(fxSpec('achuntHit').a, 'none');
    assert.equal(w.simFx('link', gun.x, gun.y, { from: gun.id, to: spring.id, kind: 'faithLink', dur: 1 }), false);
    assert.equal(count(spawned, CHAIN), 0, 'the beam is not the hit');
    assert.equal(w.simFx('achuntHit', op.x, op.y, { id: gun.id, target: op.id }), true);
    assert.equal(count(spawned, CHAIN), 1);
    assert.equal(handles.find((h) => h.key === CHAIN).opts.owner, op);
    assert.equal(handles.find((h) => h.key === CHAIN).opts.loop, false);
    assert.equal(w.simFx('achuntHit', bystander.x, bystander.y, { id: base.id, target: bystander.id }), false, 'the base form has no binding');
    assert.equal(count(spawned, CHAIN), 1);
    assert.equal(handles.find((h) => h.key === CHAIN).opts.owner, op, 'the bystander was not hit');
    assert.equal(ENEMY_FX_BINDINGS.enemy_9017_achunt, undefined);
    assert.equal(ENEMY_FX_BINDINGS.enemy_9037_aceel, undefined);
    assert.equal(ENEMY_FX_BINDINGS.enemy_1512_mcmstr, undefined);
    assert.equal(ENEMY_FX_BINDINGS.enemy_10163_mnctur_2, undefined);
    assert.equal(ENEMY_FX_BINDINGS.enemy_2123_dyjsww, undefined);
  });

  test('官方特效 off spawns neither hit', async () => {
    const { w, view, frame, spawned } = await setup({ active: false });
    const apprentice = view(1, 'enemy_1104_lfkght', 2);
    const gun = view(2, 'enemy_9017_achunt_2', 4);
    const op = view(3, 'char_test', 8, 9);
    frame();
    assert.equal(w.simFx('lfkghtHit', op.x, op.y, { id: apprentice.id, target: op.id }), false);
    assert.equal(w.simFx('achuntHit', op.x, op.y, { id: gun.id, target: op.id }), false);
    assert.equal(spawned.length, 0);
  });

  test('a missing prefab does not claim the fx', async () => {
    const { w, view, frame, spawned } = await setup({ installed: [] });
    const apprentice = view(1, 'enemy_1104_lfkght', 2);
    const gun = view(2, 'enemy_9017_achunt_2', 4);
    const op = view(3, 'char_test', 8, 9);
    frame();
    assert.equal(w.simFx('lfkghtHit', op.x, op.y, { id: apprentice.id, target: op.id }), false);
    assert.equal(w.simFx('achuntHit', op.x, op.y, { id: gun.id, target: op.id }), false);
    assert.equal(spawned.length, 0);
  });
});

describe('round 87 h3 and the extracted index', { skip: !HAS_INDEX && 'no public/assets/local/fx/index.json' }, () => {
  const idx = HAS_INDEX ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;
  const assets = () => 'ok';
  const row = (id, prefabKey, group = 'enemies') => ({ group, id, skill: { prefabKey, name: prefabKey } });
  const reason = (id, prefabKey, key) => skillPlan(idx, id, prefabKey).unmapped.find((u) => u.key === key)?.reason;
  const idle = (id, prefabKey) => auditSkill(idx, row(id, prefabKey), 'act3autochess@V3_1', new Map(), assets)
    .filter((r) => r.bucket === 'official-unmapped');

  test('the two wired hits are bound, and the rows this lane left stay unmapped', () => {
    assert.equal(reason('enemy_1104_lfkght', 'atkdesweaken', HIT), 'bound');
    assert.equal(reason('enemy_1104_lfkght_3', 'atkdesweaken', HIT), 'bound');
    assert.equal(reason('enemy_9017_achunt_2', '3', CHAIN), 'bound');
    assert.equal(reason('enemy_9017_achunt', '3', CHAIN), 'tick', 'the base gun still has no tick');

    assert.equal(reason('enemy_10003_trwlpl_2', 'eat', 'enemy_trwlpl_end-vomit_01'), 'conditional');
    assert.equal(reason('enemy_10003_trwlpl_2', 'eat', 'enemy_trcerb_common_die_01'), 'conditional');
    assert.equal(reason('enemy_10003_trwlpl_2', 'initeat', 'enemy_trwlpl_end-vomit_01'), 'conditional');
    assert.equal(reason('enemy_1512_mcmstr', 'cuttree', 'mcmstr_skill_01_hit'), 'hit-no-attack');
    assert.equal(reason('enemy_1512_mcmstr', 'cuttree', 'map_tree_brust_02_start'), 'hit-no-attack');
    assert.equal(reason('enemy_1535_wlfmster', 'fearcage', 'enemy_wlfmster_a_skill_end_start_03'), 'conditional');
    assert.equal(reason('enemy_9014_acstma', '1', 'enemy_acstma_dizzy_loop'), 'conditional');
    assert.equal(reason('enemy_9015_acstmb', '1', 'enemy_acstma_dizzy_loop'), 'conditional');
    assert.equal(reason('enemy_9029_acfnc', 'sommonsquad', 'enemy_acfnc_skill_01_locked_01'), 'hit-no-attack');
    assert.equal(reason('enemy_9029_acfnc_2', 'sommonsquad', 'enemy_acfnc_skill_01_locked_01'), 'hit-no-attack');
    assert.equal(reason('enemy_9037_aceel', 'shieldgen', 'enemy_aceel_skill_01_shield_buff'), 'conditional');
    assert.equal(reason('enemy_9037_aceel', 'shieldgen', 'enemy_aceel_skill_01_shield_end'), 'conditional');
    assert.equal(reason('enemy_9037_aceel_2', 'shieldgen', 'enemy_aceel_skill_01_shield_buff'), 'conditional');
    assert.equal(reason('token_10017_skadi2_dedant', 'sktok_skadi2_1', 'skadi2_skill_01_hit'), 'conditional');
    assert.equal(reason('token_10030_mlyss_wtrman', 'sktok_mlyss_wtrman_3', 'token_10030_mlyss_wtrman_c3_to_c0'), 'token');

    assert.ok(idle('enemy_10163_mnctur_2', 'rush').some((r) => r.reason.startsWith('index-lists-projectiles') && r.key.includes('projectile_enemy_mnctur_mark')));
    assert.ok(idle('enemy_2123_dyjsww', 'DyjswwSwitch').some((r) => r.reason.startsWith('index-lists-projectiles') && r.key.includes('projectile_enemy_dyjsww')));
    assert.equal(idle('enemy_1104_lfkght', 'AtkDesWeaken').some((r) => r.key === HIT), false);
    assert.equal(idle('enemy_9017_achunt_2', '3').some((r) => r.key === CHAIN), false);
  });
});
