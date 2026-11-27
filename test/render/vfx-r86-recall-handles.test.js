// test/render/vfx-r86-recall-handles.test.js — 伊内丝 S3's recall (skillfx.js _recall, FX_BINDINGS skchr_ines_3) with
// spawn results shaped as render/vfx/system.js returns them: OfficialFx.spawn gives an FxHandle (no anchor, no
// linkLines; its `effect` is null while the prefab loads) and each frame calls the track with the Effect, not the
// handle. Round 86 on-screen check: vfx-r86-f3.test.js's flat mocks (handle and effect in one object) hid that the
// recall wrote through the handles — the track threw, Effect.update swallowed it, and on screen the label and its
// rope stayed at the sentry, were never stopped and never played onReached on her.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { boardToUnity } from '../../public/js/render/vfx/math.js';

const TRAIL = 'ines_skill_03_label_trail_01';
const ROPE = 'ines_skill_03_pulllabel_line_01';
const REACH = 'ines_skill_03_getlabel_01';
const REACH_RANGE = 'ines_skill_03_getlabel_range_01';
const ONHIT = 'ines_skill_03_label_hit_01';
const PROJ = 'projectile_chr_ines_guard_back';

const bare = (id) => ({ rootClass: 'CastSkill', effects: [], projectiles: [], abilities: [], uses: [], node: id });

function inesIndex() {
  const prefabs = {};
  for (const k of [TRAIL, ROPE, REACH, REACH_RANGE, ONHIT]) prefabs[k] = { looping: false };
  const units = { char_4087_ines: { kind: 'char', skills: { skchr_ines_3: { ...bare('skchr_ines_3'), projectiles: [PROJ] } }, talents: {}, modes: [] } };
  return {
    units, skills: { ...units.char_4087_ines.skills }, skins: {}, prefabs,
    projectiles: {
      [PROJ]: {
        main: TRAIL, onHit: [ONHIT], onReached: [REACH, REACH_RANGE],
        movement: { class: 'AdvancedMovement', speed: 10 },
        behaviours: [
          { class: 'HarpoonProjectile', fields: { _mainEffect: TRAIL } },
          { class: 'HarpoonRenderer', fields: { _mainEffect: 'ines_skill_03_pullLabel_line_01', _useEndPointAsStartPos: 1 } },
        ],
      },
    },
    generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] },
  };
}

/** The wiring over an OfficialFx stand-in whose spawn() returns FxHandle-shaped objects (see the header). */
async function setup({ pending = false } = {}) {
  const index = inesIndex();
  const handles = [];
  const ofx = {
    active: true, time: 0, lite: false, tier: 'full', timers: [], ctx: {},
    lib: {
      has: (k) => !!index.prefabs[k],
      def: (k) => (index.prefabs[k] ? { isLoop: false, spawn: 2 } : null),
      index: async () => index,
      preload: async (keys) => keys.length,
      defs: new Map(),
    },
    spawn(key, place, opts) {
      const effect = {
        key, anchor: place.pos ? place.pos.slice() : [0, 0, 0], yaw: place.yaw ?? 0, pitch: 0, mirror: false, time: 0, state: 'play', lines: null,
        linkLines(from, to) { this.lines = { from: from.slice(), to: to.slice() }; },
        stop() { if (this.state === 'play') this.state = 'stopping'; },
      };
      const handle = {
        key, opts, place, effect: pending ? null : effect, stopped: null, pendingEffect: effect,
        get alive() { return !this.stopped; },
        stop(o = {}) { this.stopped = o; this.effect?.stop(o); },
      };
      effect.handle = handle;
      handles.push(handle);
      return handle;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: () => ({ skill: { skillId: 'skchr_ines_3', index: 2, skillType: 'MANUAL', durationType: 'NONE', duration: 10, bb: {} } }), view: (id) => views.get(id) || null });
  await w.ready();
  const her = {
    id: 1, x: 6, y: 10, z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, sp: 0, spMax: 30, dir: 'RIGHT',
    info: { id: 1, spine: 'char_4087_ines', defId: 'char_4087_ines', side: 'ally', kind: 'op', skillIndex: 2 },
  };
  views.set(1, her);
  await w.begin([...views.values()]);
  // render/vfx/system.js: OfficialFx.update → Effect.update(dt) → this.track(this) — the effect, never the handle
  const frame = (dt = 1 / 30) => {
    w.tick();
    ofx.time += dt;
    for (const h of handles) {
      const fx = h.effect;
      if (h.stopped || !fx || typeof h.opts?.track !== 'function') continue;
      fx.time += dt;
      h.opts.track(fx);
    }
  };
  return { w, her, handles, frame };
}

function near(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-6, `${actual} vs ${expected}`);
}

describe('伊内丝 S3 recall over real-shaped spawn handles', () => {
  test('the label effect flies from the sentry to her, the rope effect follows from her, both stop, onReached on her', async () => {
    const { w, her, handles, frame } = await setup();
    w.skill(her, true);
    assert.equal(w.simFx('beam', 2, 10, { id: 1, tx: 6, ty: 10 }), true);
    const trail = handles.find((h) => h.key === TRAIL);
    const rope = handles.find((h) => h.key === ROPE);
    assert.ok(trail && rope);
    near(trail.effect.anchor, boardToUnity(2, 10, 0));
    // the rope is linked at once when its prefab was loaded: from her (_useEndPointAsStartPos) to the head
    near(rope.effect.lines.from, boardToUnity(6, 10, 0));
    near(rope.effect.lines.to, boardToUnity(2, 10, 0));
    frame(0.2);   // 4 tiles at speed 10: 0.4 s, half way
    near(trail.effect.anchor, boardToUnity(4, 10, 0));
    near(rope.effect.anchor, boardToUnity(4, 10, 0));
    near(rope.effect.lines.to, boardToUnity(4, 10, 0));
    assert.equal(trail.stopped, null);
    assert.equal(handles.some((h) => h.key === REACH), false, 'not before it arrives');
    frame(0.2);
    near(trail.effect.anchor, boardToUnity(6, 10, 0));
    assert.ok(trail.stopped && rope.stopped, 'both stop when it arrives');
    const arrived = handles.filter((h) => h.key === REACH || h.key === REACH_RANGE);
    assert.equal(arrived.length, 2);
    assert.ok(arrived.every((h) => h.opts.owner === her));
    assert.equal(handles.some((h) => h.key === ONHIT), false, 'no onHit: the sim dealt the path');
    const n = handles.length;
    frame(0.2);
    assert.equal(handles.length, n, 'nothing more after the arrival');
  });

  test('a rope whose prefab is still loading gets its end points at its first tick', async () => {
    const { w, her, handles, frame } = await setup({ pending: true });
    w.skill(her, true);
    assert.equal(w.simFx('beam', 2, 10, { id: 1, tx: 6, ty: 10 }), true);
    const rope = handles.find((h) => h.key === ROPE);
    assert.equal(rope.effect, null);
    for (const h of handles) h.effect = h.pendingEffect;   // loaded (OfficialFx.spawn's lib.load → FxHandle._start)
    frame(0.1);   // 1 tile of 4 at speed 10
    near(rope.effect.lines.from, boardToUnity(6, 10, 0));
    near(rope.effect.lines.to, boardToUnity(3, 10, 0));
  });
});
