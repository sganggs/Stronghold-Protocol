// test/render/vfx-r86-f6.test.js — round 86 lane f6: official enemy effects played from the kit signal
// (ENEMY_FX_BINDINGS / ENEMY_CAST_SHOTS). Synthetic index for playback; the extracted index for the sweep's
// 'bound' mark. With 官方特效 off the procedural fx is not claimed and nothing here is spawned.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { ENEMY_FX_BINDINGS, enemyBindingKeys, skillPlan } from '../../public/js/render/vfx/skills.js';
import { auditSkill } from '../../tools/vfx-missing-fx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = path.join(ROOT, 'public/assets/local/fx/index.json');
const HAS_INDEX = existsSync(INDEX);

const KEYS = [
  'enemy_wdrrl_skill_hit_01', 'enemy_wdrrl_skill_hit_rangre_01', 'dekght_2_skill_01_range',
  'enemy_xdelk_buff_03', 'enemy_xdelk_skill_hit_01', 'enemy_dslily_skill_04_range', 'enemy_acloon_skill_hit',
  'enemy_vtlionk_skill_02_trail_01', 'enemy_vtlionk_skill_02_hit_01', 'enemy_xdpeng_die_01', 'enemy_dyjsfg_skill_01',
  'enemy_acdums_a_skill_start', 'enemy_acdums_b_skill_start', 'enemy_acdums_a_skill_start_2', 'enemy_acdums_switch',
];
const LOOPING = new Set(['enemy_xdelk_buff_03', 'enemy_acloon_skill_hit', 'enemy_vtlionk_skill_02_trail_01']);
const GROUND = new Set(['enemy_wdrrl_skill_hit_rangre_01', 'dekght_2_skill_01_range', 'enemy_dslily_skill_04_range',
  'enemy_xdpeng_die_01', 'enemy_dyjsfg_skill_01', 'enemy_acdums_a_skill_start', 'enemy_acdums_b_skill_start', 'enemy_acdums_a_skill_start_2']);

function makeIndex({ installed = KEYS } = {}) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, {
    file: `prefabs/${k}.json`, looping: LOOPING.has(k), ...(GROUND.has(k) ? { spawn: 5 } : k === 'enemy_xdelk_buff_03' ? { spawn: 4 } : {}),
  }]));
  const enemy = (o) => ({ kind: 'enemy', modes: [{ name: 'Default', attack: null, combat: null }], skills: {}, talents: {}, ...o });
  const sk = (rootAbility) => ({ rootClass: 'EnemySkill', rootAbility, projectiles: [], mode: null, uses: [] });
  return {
    units: {
      enemy_1320_wdrrl_2: enemy({}),
      enemy_1513_dekght_2: enemy({}),
      enemy_10144_xdelk_2: enemy({}),
      enemy_1521_dslily: enemy({ skills: { doom: sk('AnimatedActionToOwnerAbility') } }),
      enemy_9012_acloon: enemy({}),
      enemy_9032_aclionk: enemy({}),
      enemy_9023_acdums: enemy({}),
      enemy_10141_xdpeng_2: enemy({ skills: { switch: sk('AnimatedActionToOwnerAbility') } }),
      enemy_2124_dyjsfg: enemy({ skills: { combataoe: sk('MeleeAttack') } }),
      char_264_qiubai: { kind: 'char', modes: [], skills: {}, startEffect: null, deadEffect: null },
    },
    skills: {},
    projectiles: {
      projectile_enemy_vtlionk_s2: {
        main: 'enemy_vtlionk_skill_02_trail_01', onHit: ['enemy_vtlionk_skill_02_hit_01'], onReached: [],
        movement: { class: 'AdvancedMovement', speed: 6 }, effects: ['enemy_vtlionk_skill_02_trail_01', 'enemy_vtlionk_skill_02_hit_01'],
      },
    },
    skins: {},
    generic: { hit: {}, die: {}, birth: {}, status: {} },
    prefabs,
  };
}

const RECS = {
  enemy_10141_xdpeng_2: { skills: [{ prefabKey: 'switch', bb: {} }] },
  enemy_2124_dyjsfg: { skills: [{ prefabKey: 'CombatAoe', bb: {} }] },
  enemy_1521_dslily: { skills: [{ prefabKey: 'Doom', bb: {} }] },
};

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
  const w = new FxWiring(ofx, { speed: () => 10, record: (info) => RECS[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, x, y = 9, o = {}) => {
    const isEnemy = /^enemy_/.test(key);
    const v = {
      id, x, y, z: 0, visFacing: 1, isEnemy, alive: true, flags: 0, sp: 0, spMax: 10,
      info: { id, spine: key, defId: key, side: isEnemy ? 'enemy' : 'ally', kind: isEnemy ? 'enemy' : 'op' }, ...(o.v || {}),
    };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); ofx.time += dt; };
  return { w, ofx, view, frame, spawned, handles };
}

const count = (spawned, key) => spawned.filter((k) => k === key).length;
const live = (handles, key) => handles.filter((h) => h.key === key && h.alive);

describe('round 86 f6 enemy effects', () => {
  test('暴虐兵长 splash, 凋零骑士 arrow and 卢鲁 clash play their prefabs once; another explode does not', async () => {
    const { w, view, frame, spawned } = await setup();
    view(1, 'enemy_1320_wdrrl_2', 3);
    view(2, 'enemy_1513_dekght_2', 6);
    frame();
    assert.equal(w.simFx('explode', 4, 9, { r: 1, kind: 'aoeAttack' }), true);
    assert.equal(count(spawned, 'enemy_wdrrl_skill_hit_01'), 1);
    assert.equal(count(spawned, 'enemy_wdrrl_skill_hit_rangre_01'), 1);
    assert.equal(w.simFx('explode', 8, 9, { r: 1, kind: 'blastArrow', tiles: 'plus' }), true);
    assert.equal(count(spawned, 'dekght_2_skill_01_range'), 1);
    assert.equal(count(spawned, 'enemy_wdrrl_skill_hit_01'), 1, 'the arrow is not the splash');
    assert.equal(w.simFx('explode', 4, 9, { r: 1, kind: 'mechBomb' }), false);
    assert.equal(count(spawned, 'enemy_wdrrl_skill_hit_rangre_01'), 1);
  });

  test('卢鲁 charge holds the head loop for the telegraph, and the clash plays the hit', async () => {
    const { w, ofx, view, frame, spawned, handles } = await setup();
    const elk = view(1, 'enemy_10144_xdelk_2', 3);
    frame();
    assert.equal(w.simFx('telegraph', 4, 9, { r: 0.5, dur: 2, kind: 'elkCharge', id: elk.id }), true);
    assert.equal(count(spawned, 'enemy_xdelk_buff_03'), 1);
    assert.equal(live(handles, 'enemy_xdelk_buff_03')[0].opts.loop, true);
    assert.equal(w.simFx('explode', 4, 9, { r: 0.5, kind: 'elkClash' }), true);
    assert.equal(count(spawned, 'enemy_xdelk_skill_hit_01'), 1);
    ofx.time += 2.1;
    w.tick();
    assert.equal(live(handles, 'enemy_xdelk_buff_03').length, 0, 'the head loop ends with the charge');
  });

  test('昆图斯 species burst plays the doom range once; his tide is not that prefab', async () => {
    const { w, view, frame, spawned } = await setup();
    const q = view(1, 'enemy_1521_dslily', 5);
    frame();
    assert.equal(w.simFx('telegraph', q.x, q.y, { r: 99, dur: 4, kind: 'speciesBurst', id: q.id }), true);
    assert.equal(count(spawned, 'enemy_dslily_skill_04_range'), 1);
    assert.equal(w.simFx('tide', q.x, q.y, { id: q.id }), false);
    assert.equal(count(spawned, 'enemy_dslily_skill_04_range'), 1);
  });

  test('炎佑 burn follows the locked enemy and a second tick does not stack it', async () => {
    const { w, ofx, view, frame, spawned, handles } = await setup();
    const dragon = view(1, 'enemy_9012_acloon', 2);
    const foe = view(2, 'enemy_1007_slime', 6);
    frame();
    assert.equal(w.simFx('yanyouFlame', foe.x, foe.y, { id: dragon.id, target: foe.id, r: 1, dur: 1 }), true);
    assert.equal(count(spawned, 'enemy_acloon_skill_hit'), 1);
    const h = live(handles, 'enemy_acloon_skill_hit')[0];
    // playOn keeps a held effect with the unit through opts.track (o.follow → _placing.keep); it does not copy follow onto opts.
    assert.equal(h.opts.loop, true);
    assert.equal(typeof h.opts.track, 'function');
    assert.equal(h.opts.owner, foe);
    const fx = { anchor: [foe.x, foe.y, 0], groundZ: 0, yaw: 0, mirror: false, flipY: false };
    h.opts.track(fx);
    foe.x += 2;
    h.opts.track(fx);
    assert.equal(fx.anchor[0], foe.x, 'the burn moves with the locked enemy');
    assert.equal(w.simFx('yanyouFlame', foe.x, foe.y, { id: dragon.id, target: foe.id, r: 1, dur: 1 }), true);
    assert.equal(count(spawned, 'enemy_acloon_skill_hit'), 1, 'the next second extends the same loop');
    assert.equal(w.simFx('yanyouFlame', 6, 9, { id: dragon.id, r: 1, dur: 1 }), false, 'no lock: the procedural jet stays');
    ofx.time += 1.1;
    w.tick();
    assert.equal(live(handles, 'enemy_acloon_skill_hit').length, 0);
  });

  test('阿利斯泰尔 sword flies s2 from the blade to the target; 仇白\'s sword is left alone', async () => {
    const { w, view, frame, spawned, handles } = await setup();
    const sword = view(7, 'enemy_10028_vtswd', 2);
    const op = view(8, 'char_test', 5, 9, { v: { isEnemy: false, info: { id: 8, spine: 'char_test', defId: 'char_test', side: 'ally', kind: 'op' } } });
    const qiu = view(9, 'char_264_qiubai', 1, 9, { v: { isEnemy: false, info: { id: 9, spine: 'char_264_qiubai', defId: 'char_264_qiubai', side: 'ally', kind: 'op' } } });
    frame();
    assert.equal(w.simFx('sword', qiu.x, qiu.y, { id: qiu.id }), false);
    assert.equal(count(spawned, 'enemy_vtlionk_skill_02_trail_01'), 0);
    assert.equal(w.simFx('sword', sword.x, sword.y, { from: sword.id, to: op.id }), true);
    assert.equal(count(spawned, 'enemy_vtlionk_skill_02_trail_01'), 1);
    assert.equal(count(spawned, 'enemy_vtlionk_skill_02_hit_01'), 0, 'the hit waits for the flight');
    const trail = handles.find((h) => h.key === 'enemy_vtlionk_skill_02_trail_01');
    trail.opts.track({ time: 1, anchor: [0, 0, 0], stop() { this.stopped = true; }, kill() {}, def: null });
    assert.equal(count(spawned, 'enemy_vtlionk_skill_02_hit_01'), 1);
    const hit = handles.find((h) => h.key === 'enemy_vtlionk_skill_02_hit_01');
    assert.equal(hit.opts.owner, op);
  });

  test('羽兽 switch and 矩兽 CombatAoe play their one-shot when the cast window opens', async () => {
    const { w, view, frame, spawned } = await setup();
    const bird = view(1, 'enemy_10141_xdpeng_2', 3);
    const beast = view(2, 'enemy_2124_dyjsfg', 6);
    frame();
    assert.equal(w.enemyCast(bird, 0), true);
    assert.equal(count(spawned, 'enemy_xdpeng_die_01'), 1);
    assert.equal(w.enemyCast(beast, 0), true);
    assert.equal(count(spawned, 'enemy_dyjsfg_skill_01'), 1);
    assert.equal(w.enemyCast(bird, 1), false, 'another slot is not the switch');
    assert.equal(count(spawned, 'enemy_xdpeng_die_01'), 1);
  });

  test('余音 ensemble and pulse play the common-ability clips, and only the matching one', async () => {
    const { w, view, frame, spawned } = await setup();
    const echo = view(1, 'enemy_9023_acdums', 5);
    frame();
    assert.equal(w.simFx('explode', echo.x, echo.y, { r: 1.2, kind: 'ensembleGold' }), true);
    assert.deepEqual(spawned.slice(), ['enemy_acdums_a_skill_start']);
    assert.equal(w.simFx('explode', echo.x, echo.y, { r: 2, kind: 'ensembleDark' }), true);
    assert.equal(count(spawned, 'enemy_acdums_b_skill_start'), 1);
    assert.equal(count(spawned, 'enemy_acdums_a_skill_start'), 1);
    assert.equal(w.simFx('explode', echo.x, echo.y, { r: 1.6, kind: 'echoPulse' }), true);
    assert.equal(count(spawned, 'enemy_acdums_a_skill_start_2'), 1);
    assert.equal(count(spawned, 'enemy_acdums_switch'), 1);
    assert.equal(w.simFx('explode', echo.x, echo.y, { r: 1, kind: 'crimsonAoe' }), false);
  });

  test('官方特效 off claims none of these and spawns nothing', async () => {
    const { w, view, frame, spawned } = await setup({ active: false });
    const elk = view(1, 'enemy_10144_xdelk_2', 3);
    const dragon = view(2, 'enemy_9012_acloon', 2);
    const foe = view(3, 'enemy_1007_slime', 6);
    const bird = view(4, 'enemy_10141_xdpeng_2', 8);
    frame();
    assert.equal(w.simFx('explode', 4, 9, { kind: 'aoeAttack' }), false);
    assert.equal(w.simFx('explode', 4, 9, { kind: 'elkClash' }), false);
    assert.equal(w.simFx('telegraph', 4, 9, { kind: 'elkCharge', id: elk.id, dur: 2 }), false);
    assert.equal(w.simFx('yanyouFlame', 6, 9, { id: dragon.id, target: foe.id, dur: 1 }), false);
    assert.equal(w.simFx('sword', 2, 9, { from: 1, to: foe.id }), false);
    assert.equal(w.enemyCast(bird, 0), false);
    assert.equal(spawned.length, 0);
  });

  test('a missing prefab does not claim the fx', async () => {
    const { w, frame, spawned } = await setup({ installed: [] });
    frame();
    assert.equal(w.simFx('explode', 4, 9, { kind: 'aoeAttack' }), false);
    assert.equal(w.simFx('explode', 4, 9, { kind: 'blastArrow' }), false);
    assert.equal(spawned.length, 0);
  });
});

describe('round 86 f6 and the extracted index', { skip: !HAS_INDEX && 'no public/assets/local/fx/index.json' }, () => {
  const idx = HAS_INDEX ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;
  const assets = () => 'ok';
  const row = (id, prefabKey) => ({ group: 'enemies', id, skill: { prefabKey, name: prefabKey } });

  test('wired keys are bound or no longer an idle projectile; a left row stays unmapped', () => {
    const reason = (id, prefabKey, key) => {
      const plan = skillPlan(idx, id, prefabKey);
      return plan.unmapped.find((u) => u.key === key)?.reason;
    };
    assert.equal(reason('enemy_1320_wdrrl_2', 'aoeattack', 'enemy_wdrrl_skill_hit_01'), 'bound');
    assert.equal(reason('enemy_1320_wdrrl_2', 'aoeattack', 'enemy_wdrrl_skill_hit_rangre_01'), 'bound');
    assert.equal(reason('enemy_1513_dekght_2', 'tripleattack', 'dekght_2_skill_01_range'), 'bound');
    assert.equal(reason('enemy_10144_xdelk_2', 'skill', 'enemy_xdelk_buff_03'), 'bound');
    assert.equal(reason('enemy_10144_xdelk_2', 'skill', 'enemy_xdelk_skill_hit_01'), 'bound');
    assert.equal(reason('enemy_1521_dslily', 'doom', 'enemy_dslily_skill_04_range'), 'bound');
    assert.equal(reason('enemy_9012_acloon', 'skill_2', 'enemy_acloon_skill_hit'), 'bound');
    assert.equal(reason('enemy_10141_xdpeng_2', 'switch', 'enemy_xdpeng_die_01'), 'bound');
    assert.equal(reason('enemy_2124_dyjsfg', 'combataoe', 'enemy_dyjsfg_skill_01'), 'bound');
    assert.equal(reason('enemy_1535_wlfmster', 'fearcage', 'enemy_wlfmster_a_skill_end_start_03'), 'conditional');
    assert.equal(ENEMY_FX_BINDINGS.enemy_2123_dyjsww, undefined);
    assert.equal(ENEMY_FX_BINDINGS.enemy_10163_mnctur_2, undefined);

    const lion = enemyBindingKeys(idx, 'enemy_9032_aclionk');
    assert.ok(lion.includes('enemy_vtlionk_skill_02_trail_01') && lion.includes('enemy_vtlionk_skill_02_hit_01'));
    const idle = (id, prefabKey) => auditSkill(idx, row(id, prefabKey), 'act3autochess@V3_1', new Map(), assets)
      .filter((r) => r.bucket === 'official-unmapped');
    assert.equal(idle('enemy_9032_aclionk', 'store').some((r) => r.key.includes('projectile_enemy_vtlionk_s2')), false);
    assert.equal(idle('enemy_9032_aclionk', 'storeA').some((r) => r.key.includes('projectile_enemy_vtlionk_s2')), false);
    assert.equal(idle('enemy_1320_wdrrl_2', 'AOEAttack').some((r) => r.key === 'enemy_wdrrl_skill_hit_01'), false);
    assert.ok(idle('enemy_2123_dyjsww', 'DyjswwSwitch').some((r) => r.reason.startsWith('index-lists-projectiles') && r.key.includes('projectile_enemy_dyjsww')));
    assert.ok(idle('enemy_10163_mnctur_2', 'rush').some((r) => r.key.includes('projectile_enemy_mnctur_mark')));
    assert.ok(idle('enemy_9037_aceel', 'ShieldGen').some((r) => r.key === 'enemy_aceel_skill_01_shield_buff'));
  });
});
