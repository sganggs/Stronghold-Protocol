// test/render/vfx-r88-fxshot.test.js — round 88 on-screen check (render demo, 官方特效 full against off).
//
// 摆渡人 S2's dome for a client that starts watching mid-battle, built the way render/app.js builds that client:
// enterBattle hands FxWiring.begin bare { id, info } records (no clock) before the first frame, and a spawn event hands
// FxWiring.more the same. The skill layer used to stamp "first seen" (U.bornT) from that preload, which read as 0, so a
// late joiner looked like a viewer from the start and never got the dome. "First seen" now comes from the first frame
// that syncs the view (its gameT). The lane test (vfx-r88-g3) called begin([]) and built its views with a clock.
// 真言 S3's hops: a finished hop leaves BounceFx.shots (it used to stay listed, handle and all, until the battle ended).
// (思衡托 S3's landing, the third fix, is in vfx-r88-g1.) Synthetic indexes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { UF } from '../../shared/constants.js';

const DOME = 'varkis_skill_02_shield_1';

function makeIndex() {
  const skill = {
    rootClass: 'CastSkill', rootAbility: 'ActiveBuffAbility', effects: [], projectiles: [], mode: null,
    abilities: [], unclassified: [], roles: {}, uses: [],
  };
  return {
    units: {
      char_4166_varkis: {
        kind: 'char', talents: {}, startEffect: null, deadEffect: null, skills: { skchr_varkis_2: skill },
        modes: [{ name: 'Default', attack: null, combat: null }],
      },
    },
    skills: { skchr_varkis_2: skill },
    projectiles: {},
    skins: {}, generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] },
    prefabs: { [DOME]: { file: `prefabs/${DOME}.json`, looping: true, spawn: 1 } },
  };
}

const REC = { skill: { skillId: 'skchr_varkis_2', index: 1, skillType: 'MANUAL', durationType: 'SECONDS', duration: 30, bb: {} } };
const INFO = Object.freeze({ id: 1, spine: 'char_4166_varkis', defId: 'char_4166_varkis', side: 'ally', kind: 'op', skillIndex: 1 });

async function setup() {
  const index = makeIndex();
  const handles = [];
  const ofx = {
    active: true, time: 0, lite: false, tier: 'full', timers: [], ctx: { heightAt: () => 0 },
    lib: {
      has: (k) => !!index.prefabs[k],
      def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: index.prefabs[k].spawn } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = {
        key, place, opts, time: 0, anchor: place.pos ? place.pos.slice() : [0, 0, 0], yaw: 0,
        get alive() { return !this.stopped; },
        stop(o = {}) { this.stopped = o; },
        kill() { this.stopped = { killed: true }; },
      };
      handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: () => REC, view: (id) => views.get(id) || null });
  await w.ready();
  // render/app.js: enterBattle → wiring.begin(bare records); a 'spawn' event → wiring.more(bare records)
  await w.begin([{ id: INFO.id, info: INFO }]);
  w.more([{ id: INFO.id, info: INFO }]);
  const view = (extra = {}) => {
    const v = {
      id: INFO.id, x: 6, y: 12, z: 0, visFacing: 1, isEnemy: false, alive: true, sp: 0, spMax: 48, dir: 'RIGHT',
      flags: 0, gameT: 0, info: { ...INFO }, ...extra,
    };
    views.set(v.id, v);
    return v;
  };
  const frame = () => { w.sync([...views.values()]); w.tick(); };
  return { w, view, frame, live: () => handles.filter((h) => h.key === DOME && h.alive) };
}

describe('round 88: 摆渡人 dome for a client that joins mid-battle (preloaded first)', () => {
  test('the first frame at 36 s with the shield flag draws one dome, though the preload saw him first', async () => {
    const s = await setup();
    const him = s.view({ flags: UF.SHIELD | UF.SKILL, gameT: 36 });
    s.frame();
    assert.equal(s.w.skills.units.get(him.id).bornT, 36, 'first seen at the first synced frame, not at the preload');
    assert.equal(s.live().length, 1, 'a late joiner draws the dome from the shield flag');
    s.frame();
    assert.equal(s.live().length, 1, 'no second dome');
    him.flags = UF.SKILL;
    s.frame();
    assert.equal(s.live().length, 0, 'the flag dropping removes it');
  });

  test('a viewer from the start with another shield before the pour still draws no dome', async () => {
    const s = await setup();
    const him = s.view({ flags: UF.SHIELD, gameT: 0.1 });
    s.frame();
    assert.equal(s.live().length, 0);
    him.gameT = 12;
    s.frame();
    assert.equal(s.w.skills.units.get(him.id).bornT, 0.1, 'first seen stays the first frame');
    assert.equal(s.live().length, 0, 'an item / bond shield before any pour is not the dome');
  });
});

describe('round 88: 真言 S3 hops leave the shot list once they land', () => {
  const TRAIL = 'mantra_bounce_trail_01';
  const HIT = 'mantra_bounce_hit_01';
  async function mantra() {
    const skill = {
      rootClass: 'CastSkill', rootAbility: 'ActiveBuffAbility', effects: [], projectiles: ['projectile_chr_mantra_s3_2'],
      mode: null, abilities: [], unclassified: [], roles: {}, uses: [],
    };
    const index = {
      units: {
        char_4204_mantra: {
          kind: 'char', talents: {}, startEffect: null, deadEffect: null, skills: { skchr_mantra_3: skill },
          modes: [{ name: 'Default', attack: null, combat: null }],
        },
      },
      skills: { skchr_mantra_3: skill },
      projectiles: {
        projectile_chr_mantra_s3_2: {
          main: TRAIL, onHit: [HIT], lifeTime: 0,
          movement: { class: 'BouncedAdvancedMovement', moveType: 1, speed: 30, speedAfterFirstReach: 4, comeBack: 0 },
        },
      },
      skins: {}, generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] },
      prefabs: { [TRAIL]: { file: 'prefabs/t.json', looping: true, spawn: 0 }, [HIT]: { file: 'prefabs/h.json', looping: false, spawn: 2 } },
    };
    const handles = [];
    const ofx = {
      active: true, time: 0, lite: false, tier: 'full', timers: [],
      lib: {
        has: (k) => !!index.prefabs[k],
        def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: index.prefabs[k].spawn } : null),
        index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
      },
      spawn(key, place, opts) {
        const h = { key, place, opts, anchor: place.pos.slice(), stopped: null, get alive() { return !this.stopped; }, stop(o = {}) { this.stopped = o; } };
        handles.push(h);
        return h;
      },
    };
    const views = new Map();
    const w = new FxWiring(ofx, {
      speed: () => 10,
      record: () => ({ charId: 'char_4204_mantra', skill: { skillId: 'skchr_mantra_3', index: 2, duration: 40 } }),
      view: (id) => views.get(id) || null,
    });
    await w.ready();
    const her = {
      id: 1, x: 2, y: 10, z: 0, visFacing: 1, isEnemy: false, alive: true, flags: UF.SKILL, sp: 0, spMax: 46, dir: 'RIGHT',
      gameT: 20, info: { id: 1, spine: 'char_4204_mantra', defId: 'char_4204_mantra', side: 'ally', kind: 'op', skillIndex: 2 },
    };
    views.set(1, her);
    const track = () => { for (const h of handles) if (!h.stopped && typeof h.opts?.track === 'function') h.opts.track(h); };
    return { w, ofx, her, handles, track };
  }

  test('one hop: listed while it flies, gone after its hit, and its hit plays once', async () => {
    const m = await mantra();
    assert.equal(m.w.simFx('mantraHop', 4, 11.7, { id: m.her.id, target: 8, tx: 5.33, ty: 12, speed: 3.2 }), true);
    assert.equal(m.w.bounces.shots.length, 1);
    m.ofx.time = 0.2;
    m.track();
    assert.equal(m.w.bounces.shots.length, 1, 'still in the air (1.36 tiles at 3.2 tiles/s)');
    m.ofx.time = 0.5;
    m.track();
    assert.equal(m.w.bounces.shots.length, 0, 'the landed hop is dropped');
    assert.equal(m.handles.filter((h) => h.key === HIT).length, 1);
    m.track();
    assert.equal(m.handles.filter((h) => h.key === HIT).length, 1, 'no second hit from a fading trail');
  });
});
