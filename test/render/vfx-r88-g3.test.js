// test/render/vfx-r88-g3.test.js — round 88 lane g3.
//
// 谬因 S2: one polyline through the beam's tiles (start on her, waypoint only on a 中继器 index, end on the last
// tile). A later path replaces it. Fewer than two tiles, a missing line, or 官方特效 off leaves the procedural beam.
// 阿斯卡纶 S2: ascln_buff_01 is one loop on the named enemy; a later asclnDread extends it; asclnDreadEnd or the
// enemy's death drops it. 旅骨 S1 / S2 and 承曦格雷伊 S2 start the range when the throw lands. 摆渡人 S2's dome
// comes back from UF.SHIELD on a snapshot that never saw the pour. Synthetic index. Nothing of this plays with
// 官方特效 off. The real public/assets/local index is not read here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS } from '../../public/js/render/vfx/skills.js';
import { fxSpec } from '../../public/js/render/fx/kinds.js';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';
import { UF } from '../../shared/constants.js';

const LINE = 'aphris_skill_02_line_01';
const START = 'aphris_skill_02_start_01';
const END = 'aphris_skill_02_line_point_01';
const WAY = 'token_aphris_pc_skill_02_buff_01';
const HIT = 'aphris_skill_02_hit_01';
const DREAD = 'ascln_buff_01';
const DOME = 'varkis_skill_02_shield_1';
const H_RANGE = 'hbound_skill1_range_01';
const H_TRAIL = 'hbound_trail_01';
const H_HIT = 'hbound_skill1_hit_01';
const G_RANGE = 'greyy2_skill_02_range';
const G_TRAIL = 'greyy2_skill_02_trail';
const G_HIT = 'greyy2_skill_02_hit_02';
const ALL = [LINE, START, END, WAY, HIT, DREAD, DOME, H_RANGE, H_TRAIL, H_HIT, G_RANGE, G_TRAIL, G_HIT];
const LOOPING = new Set([LINE, START, END, WAY, DREAD, DOME, H_RANGE, H_TRAIL, G_RANGE, G_TRAIL]);

function skillNode(projectiles = []) {
  return {
    rootClass: 'CastSkill', rootAbility: 'ActiveBuffAbility', effects: [], projectiles, mode: null,
    abilities: [], unclassified: [], roles: {}, uses: [],
  };
}

function makeIndex(installed = ALL) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, {
    file: `prefabs/${k}.json`, looping: LOOPING.has(k), spawn: k === HIT || k === H_HIT || k === G_HIT ? 2 : 0,
  }]));
  const unit = (skills) => ({
    kind: 'char', talents: {}, startEffect: null, deadEffect: null, skills,
    modes: [{ name: 'Default', attack: null, combat: null }],
  });
  const aphris = skillNode();
  const ascln = skillNode();
  const varkis = skillNode();
  const hbound = skillNode(['projectile_chr_hbound_s1']);
  const greyy = skillNode(['projectile_chr_greyy2_s2']);
  return {
    units: {
      char_4229_aphris: unit({ skchr_aphris_2: aphris }),
      char_4132_ascln: unit({ skchr_ascln_2: ascln }),
      char_4166_varkis: unit({ skchr_varkis_2: varkis }),
      char_4232_hbound: unit({ skchr_hbound_1: hbound }),
      char_1027_greyy2: unit({ skchr_greyy2_2: greyy }),
    },
    skills: {
      skchr_aphris_2: aphris, skchr_ascln_2: ascln, skchr_varkis_2: varkis,
      skchr_hbound_1: hbound, skchr_greyy2_2: greyy,
    },
    projectiles: {
      projectile_chr_hbound_s1: { main: H_TRAIL, onReached: [H_RANGE], onHit: [], movement: { class: 'ParacurveMovement', speed: 10 }, effects: [H_TRAIL, H_RANGE] },
      projectile_chr_greyy2_s2: { main: G_TRAIL, onReached: [G_RANGE], onHit: [G_HIT], movement: { class: 'AdvancedMovement', speed: 8 }, effects: [G_TRAIL, G_RANGE, G_HIT] },
    },
    skins: {}, generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] }, prefabs,
  };
}

const RECS = {
  char_4229_aphris: { skill: { skillId: 'skchr_aphris_2', index: 0, skillType: 'MANUAL', durationType: 'SECONDS', duration: 8, bb: {} } },
  char_4132_ascln: { skill: { skillId: 'skchr_ascln_2', index: 0, skillType: 'MANUAL', durationType: 'SECONDS', duration: 35, bb: {} } },
  char_4166_varkis: { skill: { skillId: 'skchr_varkis_2', index: 0, skillType: 'MANUAL', durationType: 'SECONDS', duration: 20, bb: {} } },
  char_4232_hbound: { skill: { skillId: 'skchr_hbound_1', index: 0, skillType: 'MANUAL', durationType: 'NONE', duration: 0, bb: { interval: 1 } } },
  char_1027_greyy2: { skill: { skillId: 'skchr_greyy2_2', index: 0, skillType: 'MANUAL', durationType: 'SECONDS', duration: 16, bb: {} } },
};

async function setup({ installed = ALL, active = true } = {}) {
  const index = makeIndex(installed);
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [], ctx: { heightAt: () => 0 },
    lib: {
      has: (k) => !!index.prefabs[k],
      def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: index.prefabs[k].spawn } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = {
        key, place, opts, time: 0, anchor: place.pos ? place.pos.slice() : [0, 0, 0], yaw: 0, linePath: null, linePathN: 0,
        get alive() { return !this.stopped; },
        stop(o = {}) { this.stopped = o; },
        kill() { this.stopped = { killed: true }; },
        setLinePath(points) { this.linePath = points.map((p) => p.slice()); this.linePathN += 1; },
      };
      handles.push(h);
      return h;
    },
  };
  const views = new Map();
  let seq = 1;
  const w = new FxWiring(ofx, {
    speed: () => 10,
    record: (info) => RECS[info.defId] || null,
    view: (id) => views.get(id) || null,
  });
  await w.ready();
  const view = (defId, x, y, extra = {}) => {
    const id = extra.id ?? seq++;
    seq = Math.max(seq, id + 1);
    const v = {
      id, x, y, z: extra.z || 0, visFacing: 1, isEnemy: !!extra.isEnemy, alive: extra.alive !== false,
      flags: extra.flags || 0, sp: 0, spMax: 30, dir: 'RIGHT',
      info: { id, spine: defId, defId, side: extra.isEnemy ? 'enemy' : 'ally', kind: extra.isEnemy ? 'enemy' : 'op', skillIndex: extra.skillIndex ?? 0 },
    };
    views.set(id, v);
    return v;
  };
  const frame = () => { w.sync([...views.values()]); w.tick(); };
  await w.begin([]);
  frame();
  return { w, ofx, view, frame, handles, views, keys: () => handles.map((h) => h.key), live: (k) => handles.filter((h) => h.key === k && h.alive) };
}

const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

describe('round 88 lane g3', () => {
  test('the bindings name the official keys, and the new kinds draw nothing with 官方特效 off', () => {
    const a = FX_BINDINGS.skchr_aphris_2;
    assert.equal(a.beam.claim, true);
    assert.deepEqual(a.beam.path, a.aphrisPath.path);
    assert.deepEqual([a.beam.path.start, a.beam.path.line, a.beam.path.end, a.beam.path.waypoint], [START, LINE, END, WAY]);
    assert.deepEqual([...a.aphrisHit.keys], [HIT]);
    assert.equal(a.aphrisHit.oneshot, true);
    assert.equal(FX_BINDINGS.skchr_ascln_2.asclnDread.refresh, true);
    assert.equal(FX_BINDINGS.skchr_ascln_2.asclnDreadEnd.stopRefresh, 'asclnDread');
    assert.equal(FX_BINDINGS.skchr_ascln_2.aoe.keys.includes(DREAD), false);
    assert.deepEqual([...FX_BINDINGS.skchr_hbound_1.zone.arrive], [H_RANGE]);
    assert.deepEqual([...FX_BINDINGS.skchr_hbound_2.zone.arrive], ['hbound_skill2_range_01']);
    assert.deepEqual([...FX_BINDINGS.skchr_greyy2_2.zone.arrive], [G_RANGE]);
    for (const k of ['aphrisPath', 'aphrisHit', 'asclnDread', 'asclnDreadEnd']) assert.equal(fxSpec(k).a, 'none', k);
    assert.equal(fxSpec('beam').a, 'beam', 'the procedural beam stays the stand-in');
  });

  test('谬因 S2 draws one line through the tiles, a waypoint only on the relay, and replaces it when the path changes', async () => {
    const { w, view, handles, live, keys } = await setup();
    const her = view('char_4229_aphris', 2, 9);
    w.skill(her, true);
    const path = [9, 2, 9, 3, 9, 4, 10, 4, 11, 4, 11, 5];
    assert.equal(w.simFx('beam', 2, 9, { id: her.id, skill: 'aphris:beam', path, relays: [2] }), true);
    assert.equal(live(LINE).length, 1);
    assert.equal(live(START).length, 1);
    assert.equal(live(END).length, 1);
    assert.equal(live(WAY).length, 1);
    const line = handles.find((h) => h.key === LINE);
    const flat0 = (n) => Math.round((n + 0) * 1000) / 1000;
    assert.deepEqual(line.linePath.map((p) => p.map(flat0)), [
      [-8, 0, 0], [-7, 0, 0], [-6, 0, 0], [-6, 1, 0], [-6, 2, 0], [-5, 2, 0],
    ]);
    assert.ok(near(handles.find((h) => h.key === WAY).place.pos, [-6, 0, 0]), 'the waypoint is the relay tile (9, 4)');
    assert.ok(near(handles.find((h) => h.key === END).place.pos, [-5, 2, 0]), 'the end is the last tile');
    assert.ok(near(handles.find((h) => h.key === START).place.pos, [-8, 0, 0]), 'the start sits on her');
    const n = keys().length;
    assert.equal(w.simFx('aphrisPath', 2, 9, { id: her.id, skill: 'aphris:beam', path, relays: [2] }), true);
    assert.equal(keys().length, n, 'the same tiles keep the one line');
    assert.equal(w.simFx('aphrisPath', 2, 9, { id: her.id, skill: 'aphris:beam', path: [9, 2, 9, 4], relays: [1] }), true);
    assert.ok(line.stopped, 'a different path stops the old line');
    const again = live(LINE);
    assert.equal(again.length, 1);
    assert.equal(live(WAY).length, 1);
    assert.equal(live(END).length, 1);
    assert.ok(near(live(WAY)[0].place.pos, [-6, 0, 0]) && near(live(END)[0].place.pos, [-6, 0, 0]), 'a path that ends on the relay draws both there');
    assert.equal(again[0].linePath.length, 2);
  });

  test('谬因 S2 plays one channel hit per named enemy, and drops the line with the skill', async () => {
    const { w, view, live, frame } = await setup();
    const her = view('char_4229_aphris', 2, 9);
    const foe = view('enemy_dummy', 4, 10, { isEnemy: true });
    w.skill(her, true);
    assert.equal(w.simFx('aphrisHit', foe.x, foe.y, { id: her.id, target: foe.id, skill: 'aphris:beam' }), true);
    assert.equal(live(HIT).length, 1);
    assert.notEqual(live(HIT)[0].opts.loop, true);
    assert.equal(w.simFx('aphrisHit', foe.x, foe.y, { id: her.id, target: foe.id, skill: 'aphris:beam' }), true);
    assert.equal(live(HIT).length, 2, 'each tick that damaged him plays another oneshot');
    w.simFx('beam', 2, 9, { id: her.id, skill: 'aphris:beam', path: [9, 2, 9, 4, 11, 4], relays: [1] });
    assert.equal(live(LINE).length, 1);
    w.skill(her, false);
    assert.equal(live(LINE).length, 0);
    assert.equal(live(START).length, 0);
    assert.equal(live(WAY).length, 0);
    her.flags = UF.SKILL;
    frame();
    assert.equal(live(LINE).length, 0, 'a snapshot has no waypoints, so the line does not come back');
  });

  test('谬因 S2 leaves the procedural beam when the line cannot be drawn', async () => {
    const off = await setup({ active: false });
    const her = off.view('char_4229_aphris', 2, 9);
    off.w.skill(her, true);
    assert.equal(off.w.simFx('beam', 2, 9, { id: her.id, skill: 'aphris:beam', path: [9, 2, 9, 4], relays: [1] }), false);
    assert.equal(off.keys().length, 0);
    const { w, view, keys } = await setup();
    const late = view('char_4229_aphris', 2, 9);
    w.skill(late, true);
    assert.equal(w.simFx('beam', 2, 9, { id: late.id, skill: 'aphris:beam', path: [9, 2], relays: [] }), false, 'one tile is not a line');
    assert.equal(keys().includes(LINE), false);
    const bare = await setup({ installed: ALL.filter((k) => k !== LINE) });
    const b = bare.view('char_4229_aphris', 2, 9);
    bare.w.skill(b, true);
    assert.equal(bare.w.simFx('beam', 2, 9, { id: b.id, skill: 'aphris:beam', path: [9, 2, 9, 4], relays: [1] }), false);
    assert.equal(bare.keys().includes(START), false, 'no line, so no start or waypoint either');
    assert.equal(bare.keys().includes(WAY), false);
  });

  test('a tier switch redraws the line from the tiles already received; a death does not', async () => {
    const { w, ofx, view, frame, live } = await setup();
    const her = view('char_4229_aphris', 2, 9);
    w.skill(her, true);
    const path = [9, 2, 9, 4, 11, 4];
    assert.equal(w.simFx('beam', 2, 9, { id: her.id, skill: 'aphris:beam', path, relays: [1] }), true);
    const first = live(LINE)[0];
    ofx.tier = 'lite';
    frame();
    assert.ok(first.stopped, 'the tier switch cleared the handles');
    assert.equal(live(LINE).length, 1, 'the stored tiles draw it again');
    assert.equal(live(WAY).length, 1);
    her.alive = false;
    frame();
    assert.equal(live(LINE).length, 0);
    her.alive = true;
    frame();
    assert.equal(live(LINE).length, 0, 'death forgot the tiles');
  });

  test('阿斯卡纶 S2 holds one dread loop, extends it, and stops it on the end fx or on death', async () => {
    const { w, ofx, view, frame, live } = await setup();
    const her = view('char_4132_ascln', 4, 9);
    const foe = view('enemy_dummy', 6, 9, { isEnemy: true });
    w.skill(her, true);
    const t0 = ofx.time;
    assert.equal(w.simFx('asclnDread', foe.x, foe.y, { id: her.id, target: foe.id, duration: 25, skill: 'ascln:dread' }), true);
    assert.equal(live(DREAD).length, 1);
    assert.equal(live(DREAD)[0].opts.loop, true);
    const first = ofx.timers.at(-1).at;
    assert.ok(Math.abs(first - (t0 + 25)) < 1e-6);
    ofx.time = t0 + 10;
    w.tick();
    assert.equal(w.simFx('asclnDread', foe.x, foe.y, { id: her.id, target: foe.id, duration: 25, skill: 'ascln:dread' }), true);
    assert.equal(live(DREAD).length, 1, 'a refresh does not stack');
    const second = ofx.timers.at(-1).at;
    assert.ok(Math.abs(second - (t0 + 10 + 25)) < 1e-6);
    ofx.time = first;
    w.tick();
    assert.equal(live(DREAD).length, 1, 'the first deadline does not stop the extended loop');
    ofx.time = second;
    w.tick();
    assert.equal(live(DREAD).length, 0);
    assert.equal(w.simFx('asclnDread', foe.x, foe.y, { id: her.id, target: foe.id, duration: 25, skill: 'ascln:dread' }), true);
    assert.equal(w.simFx('asclnDreadEnd', foe.x, foe.y, { id: her.id, target: foe.id, skill: 'ascln:dread' }), true);
    assert.equal(live(DREAD).length, 0, 'the end fx drops it');
    w.skill(her, false);
    assert.equal(w.simFx('asclnDread', foe.x, foe.y, { id: her.id, target: foe.id, duration: 25, skill: 'ascln:dread' }), true, 'the debuff outlives the skill');
    foe.alive = false;
    frame();
    assert.equal(live(DREAD).length, 0, 'death drops it');
  });

  test('阿斯卡纶 S2 plays no dread with 官方特效 off, without the tag, or without the prefab', async () => {
    const off = await setup({ active: false });
    const her = off.view('char_4132_ascln', 4, 9);
    const foe = off.view('enemy_dummy', 6, 9, { isEnemy: true });
    off.w.skill(her, true);
    assert.equal(off.w.simFx('asclnDread', 6, 9, { id: her.id, target: foe.id, duration: 25, skill: 'ascln:dread' }), false);
    assert.equal(off.keys().length, 0);
    const { w, view } = await setup();
    const a = view('char_4132_ascln', 4, 9);
    const e = view('enemy_dummy', 6, 9, { isEnemy: true });
    w.skill(a, true);
    assert.equal(w.simFx('asclnDread', 6, 9, { id: a.id, target: e.id, duration: 25 }), false, 'no skill tag');
    const bare = await setup({ installed: ALL.filter((k) => k !== DREAD) });
    const b = bare.view('char_4132_ascln', 4, 9);
    const t = bare.view('enemy_dummy', 6, 9, { isEnemy: true });
    bare.w.skill(b, true);
    assert.equal(bare.w.simFx('asclnDread', 6, 9, { id: b.id, target: t.id, duration: 25, skill: 'ascln:dread' }), false);
  });

  test('旅骨 S1 and 承曦格雷伊 S2 start the range at the landing, and the tick hit does not wait', async () => {
    const land = (handles, key, time) => {
      const shot = handles.find((h) => h.key === key && h.opts && typeof h.opts.track === 'function');
      shot.opts.track({ time, anchor: [0, 0, 0], stop() {}, kill() { this.stopped = true; } });
    };
    const bone = await setup();
    const her = bone.view('char_4232_hbound', 4, 9);
    bone.w.skill(her, true);
    const t0 = bone.ofx.time;
    assert.equal(bone.w.simFx('zone', 6, 9, { id: her.id, radius: 1.5, dur: 8 }), true);
    assert.ok(bone.keys().includes(H_TRAIL) && bone.keys().includes(H_HIT));
    assert.equal(bone.keys().includes(H_RANGE), false);
    const timers = bone.ofx.timers.length;
    land(bone.handles, H_TRAIL, 0.1);
    assert.equal(bone.keys().includes(H_RANGE), false, 'still in the air at 0.1 s (the flight is 0.2 s)');
    land(bone.handles, H_TRAIL, 0.2);
    assert.equal(bone.keys().filter((k) => k === H_RANGE).length, 1);
    assert.equal(bone.live(H_RANGE)[0].opts.loop, true);
    assert.equal(bone.ofx.timers.length, timers + 1, 'the range\'s stop is armed at the landing');
    const rangeStop = bone.ofx.timers.at(-1).at;
    assert.ok(Math.abs(rangeStop - (t0 + 8)) < 1e-6, 'the hold is throw + 8 s, not landing + 8 s');

    const grey = await setup();
    const g = grey.view('char_1027_greyy2', 4, 9);
    grey.w.skill(g, true);
    const g0 = grey.ofx.time;
    assert.equal(grey.w.simFx('zone', 6, 9, { id: g.id, radius: 1, dur: 8 }), true);
    assert.ok(grey.keys().includes(G_TRAIL));
    assert.equal(grey.keys().includes(G_RANGE), false);
    assert.equal(grey.keys().includes(G_HIT), false);
    assert.equal(grey.w.simFx('zone', 6, 9, { id: g.id, radius: 1, dur: 8 }), true, 'the re-sent zone is already covered');
    assert.equal(grey.keys().filter((k) => k === G_TRAIL).length, 1);
    land(grey.handles, G_TRAIL, 0.2);
    assert.equal(grey.keys().includes(G_RANGE), false, '2/8 s has not elapsed');
    land(grey.handles, G_TRAIL, 0.25);
    assert.equal(grey.keys().filter((k) => k === G_RANGE).length, 1);
    assert.equal(grey.keys().filter((k) => k === G_HIT).length, 1);
    assert.ok(Math.abs(grey.ofx.timers.at(-1).at - (g0 + 8)) < 1e-6);
  });

  test('摆渡人 S2\'s dome comes back from the snapshot\'s shield flag, and a live pour does not stack', async () => {
    const { w, view, frame, live } = await setup();
    const him = view('char_4166_varkis', 5, 9, { flags: UF.SHIELD });
    frame();
    assert.equal(live(DOME).length, 1, 'a client that joins mid-barrier draws the dome');
    assert.equal(live(DOME)[0].opts.loop, true);
    frame();
    assert.equal(live(DOME).length, 1, 'the next frame does not stack another');
    him.flags = 0;
    frame();
    assert.equal(live(DOME).length, 0, 'the flag dropping removes it');
    him.flags = UF.SHIELD;
    frame();
    assert.equal(live(DOME).length, 1);

    const livePour = await setup();
    const v = livePour.view('char_4166_varkis', 5, 9, { flags: UF.SHIELD });
    livePour.w.skill(v, true);
    assert.equal(livePour.w.simFx('varkisShield', v.x, v.y, { id: v.id, skill: 'varkis:shield' }), true);
    assert.equal(livePour.live(DOME).length, 1);
    livePour.frame();
    assert.equal(livePour.live(DOME).length, 1, 'sync does not pour a second dome');
    livePour.w.skill(v, false);
    assert.equal(livePour.live(DOME).length, 1, 'the skill ending leaves the barrier');
    assert.equal(livePour.w.simFx('varkisShieldEnd', v.x, v.y, { id: v.id, skill: 'varkis:shield' }), true);
    assert.equal(livePour.live(DOME).length, 0);
    livePour.frame();
    assert.equal(livePour.live(DOME).length, 1, 'the snapshot still carries the shield, so the next frame draws it again');
    v.flags = 0;
    livePour.frame();
    assert.equal(livePour.live(DOME).length, 0);

    const off = await setup({ active: false });
    off.view('char_4166_varkis', 5, 9, { flags: UF.SHIELD });
    off.frame();
    assert.equal(off.keys().length, 0);
    const other = await setup();
    other.view('char_4132_ascln', 5, 9, { flags: UF.SHIELD });
    other.frame();
    assert.equal(other.keys().includes(DOME), false, 'another operator\'s shield is not his dome');
  });
});

describe('setLinePath', () => {
  const MAT = {
    name: 'm', shader: 'Torappu/Particles/Additive',
    passes: [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Off', colorMask: 15 }],
    queue: 'Transparent', keywords: [], floats: {}, colors: { _TintColor: [1, 1, 1, 1] }, textures: { _MainTex: { tex: 't', st: [1, 1, 0, 0] } },
  };
  const node = (id, parent, extra) => ({
    id, name: `n${id}`, parent, children: [], active: true, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1], ...extra,
  });
  const line = () => ({ lineRenderer: { m_Enabled: true, materials: [0], m_UseWorldSpace: true, m_Positions: [[5, 4, 0], [6, 3, 0]], m_Parameters: { widthMultiplier: 0.5, widthCurve: [[0, 1, 0, 0]], colorGradient: null, alignment: 0, textureMode: 0 } } });

  test('a polyline replaces the two-point rope, the same array is a no-op, and a null point does not apply', () => {
    const nodes = [node(0, null, { behaviours: [{ class: 'ParticleEffect', enabled: true, fields: { _delayToPlay: 0, _delayToFinish: 0, _maxLifetime: -1, _isLoop: 1, _rotateType: 0, _spawnLocation: 0 } }] }), node(1, 0, line())];
    nodes[0].children.push(1);
    const fx = new Effect(compileEffect({ format: 'fx-prefab', version: 1, key: 'test', nodes, materials: [MAT], clips: [], textures: ['t'], meshes: [], refs: [], stats: {} }), { seed: 1 });
    const pts = [[-8, 0, 0], [-7, 0, 0], [-6, 1, 0]];
    fx.setLinePath(pts);
    const stored = fx.linePts.get(1);
    assert.equal(stored.length, 3);
    assert.deepEqual(stored[2], [-6, 1, 0]);
    pts[2][0] = 99;
    assert.equal(stored[2][0], -6, 'the effect keeps its own copy');
    fx.setLinePath(pts);
    assert.equal(stored[2][0], -6, 'the same array is not applied again');
    fx.linkLines([0, 0, 0], [1, 0, 0]);
    assert.equal(fx.linePts.get(1).length, 2);
    assert.equal(fx._linePath, null);
    const kept = fx.linePts.get(1);
    fx.setLinePath([[1, 0, 0], null, [3, 0, 0]]);
    assert.equal(fx.linePts.get(1), kept, 'a null point leaves the line as it was');
    assert.equal(fx._linePath, null);
  });
});

