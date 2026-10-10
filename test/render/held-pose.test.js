// test/render/held-pose.test.js — a model whose pose cannot change is neither re-posed nor redrawn (render/spine.js
// SpineActor.poseHeld, render/units.js UnitView.update / _updateImpostor): a knocked-out operator lying in the held end
// of its Die clip, a frozen model. On a slow device in a late round a dozen operators lie so, and each was re-posed and
// redrawn into the impostor atlas every couple of frames for the same pixels. The actor's clock still runs; anything
// that can move the pose again (a new clip, a revive, a wind-up, a form's closing clip, clipping masks switched, a zoom
// past the impostor's rescale threshold, a tint the slots do not show yet) brings the updates back. Headless fake PIXI
// (test/render/fakepixi.js).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, UnitView, DOWN_STATE, SpineActor;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, DOWN_STATE } = await import('../../public/js/render/units.js'));
  ({ SpineActor } = await import('../../public/js/render/spine.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('normal', { width: 1280, height: 720 });
const ENTRY = { skel: '/s/op.skel', atlas: '/s/op.atlas', textures: ['/s/op.png'], anims: { idle: 'Idle', die: 'Die' }, animations: { Idle: 1, Die: 0.8 } };
const DATA = { animations: [{ name: 'Idle' }, { name: 'Die' }] };
/** Play the current track 0 clip to its end (the fake skeleton does not advance clip time itself). */
const finish = (a) => { const e = a.spine.state.tracks[0]; e.trackTime = e.animationEnd - e.animationStart; };

describe('SpineActor.poseHeld', () => {
  test('a dead model on the finished end of its Die clip is held; a clip still playing, looping or mixing is not', () => {
    const a = new SpineActor(DATA, ENTRY);
    assert.equal(a.poseHeld(), false, 'idle loop');
    a.die();
    assert.equal(a.current, 'Die');
    assert.equal(a.poseHeld(), false, 'falling');
    finish(a);
    assert.equal(a.poseHeld(), false, 'not before an update has posed the end of the clip');
    a.update(0);
    assert.equal(a.poseHeld(), true, 'lying on the last frame');
    const e = a.spine.state.tracks[0];
    e.mixingFrom = {};
    assert.equal(a.poseHeld(), false, 'still mixing out of the previous clip');
    e.mixingFrom = null;
    a.spine.state.tracks[1] = {};
    assert.equal(a.poseHeld(), false, 'another track plays');
    a.spine.state.tracks.length = 1;
    e.loop = true;
    assert.equal(a.poseHeld(), false, 'a looping clip moves on');
    e.loop = false;
    assert.equal(a.poseHeld(), true);
    a.revive();
    assert.equal(a.poseHeld(), false, 'standing again');
  });

  test('a skeleton without a Die clip holds its idle at timeScale 0 at once; a frozen model is held', () => {
    const a = new SpineActor({ animations: [{ name: 'Idle' }] }, { ...ENTRY, anims: { idle: 'Idle' }, animations: { Idle: 1 } });
    a.die();
    assert.equal(a.spine.state.tracks[0].timeScale, 0);
    assert.equal(a.poseHeld(), false, 'not before an update has posed it');
    a.update(0);
    assert.equal(a.poseHeld(), true);
    const b = new SpineActor(DATA, ENTRY);
    b.frozen = true;
    b.update(0);
    assert.equal(b.poseHeld(), true, 'frozen: update never moves the skeleton');
  });

  test('a tint the slots do not show yet waits for one update (pixi-spine applies tint in update)', () => {
    const a = new SpineActor(DATA, ENTRY);
    a.die();
    finish(a);
    a.update(0);
    assert.equal(a.poseHeld(), true);
    a.spine.tint = 0xb4b4b4;                            // the knocked-out grey, set after the frame's update
    assert.equal(a.poseHeld(), false, 'the new tint is not on the slots yet');
    a.update(0);
    assert.equal(a.poseHeld(), true, 'shown: held again');
  });

  test('never while something pending acts on the clock: a form\'s closing clip, a wind-up', () => {
    const a = new SpineActor(DATA, ENTRY);
    a.die();
    finish(a);
    a.update(0);
    a.endClip = 'Die'; a.endAt = 5;
    assert.equal(a.poseHeld(), false, 'closing clip pending');
    a.endClip = null;
    a.windUntil = 3;
    assert.equal(a.poseHeld(), false, 'wind-up pending');
    a.windUntil = null;
    a.frozen = true;
    a.endClip = 'X';
    assert.equal(a.poseHeld(), false, 'frozen, but a closing clip is due');
  });
});

describe('UnitView: a held pose is neither re-posed nor redrawn', () => {
  /** An operator with a Spine model in a context with an impostor atlas (interval `iv`) and counters. */
  async function operator(iv) {
    let frame = 0;
    let draws = 0;
    let clip = true;
    const atlas = {
      alloc: (w, h, o) => ({ w, h, tex: new fake.P.Texture(), clip: !!o?.clip }),
      free() {}, park(o) { o.visible = false; }, unpark(o) { o.visible = true; }, draw() { draws++; },
    };
    const ctx = fakeViewCtx(fake.P, {
      cam, frameNo: () => frame, impostors: atlas, impostorInterval: () => iv, clipAllowed: () => clip,
      renderer: { resolution: 1, render() {} },
      assets: { picture: () => null, image: async () => null, spineEntry: () => ENTRY, spine: { acquire: async () => DATA, release() {} } },
    });
    const v = new UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId: 'char_x', tier: 3, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT' });
    await tick(); await tick();
    assert.ok(v.spineReady, 'spine ready');
    let updates = 0;
    const upd = v.actor.update.bind(v.actor);
    v.actor.update = (dt) => { updates++; return upd(dt); };
    const step = (n = 1) => { for (let i = 0; i < n; i++) { v.update(1 / 60, cam(), frame / 60); frame++; } };
    const counts = () => ({ updates, draws });
    return { v, step, counts, setClip: (on) => { clip = on; } };
  }
  const knockOut = (v) => { v.setDown([1, 60, 60, DOWN_STATE.COUNTING], 1); };

  test('impostor mode: lying in the held Die pose, no re-pose and no atlas redraw; the clock still runs', async () => {
    const { v, step, counts } = await operator(2);
    step(4);
    assert.ok(v.imp, 'impostor mode');
    knockOut(v);
    step(4);
    const falling = counts();
    assert.ok(falling.updates >= 2 && falling.draws >= 2, 'the fall is animated');
    finish(v.actor);
    step(1);                                            // the frame the clip ends on may still draw (dirty / turn)
    const c0 = counts(), clock0 = v.actor.clock;
    step(60);
    assert.deepEqual(counts(), c0, 'one second down: nothing re-posed, nothing redrawn');
    assert.ok(Math.abs(v.actor.clock - clock0 - 1) < 1e-6, `the actor clock ran on (${v.actor.clock - clock0})`);
    assert.ok(v._downRing.root.visible, 'under its redeploy ring');
  });

  test('a zoom past the rescale threshold, clipping masks switched or a redeploy bring the redraws back', async () => {
    const { v, step, counts, setClip } = await operator(2);
    step(4);
    knockOut(v);
    step(2);
    finish(v.actor);
    step(2);
    let c = counts();
    v.modelK *= 1.3;                                    // the impostor's scale is off by > 12 %
    step(1);
    assert.equal(counts().draws, c.draws + 1, 'redrawn once at the new scale');
    step(10);
    assert.equal(counts().draws, c.draws + 1, 'then held again');
    v.actor.clipped = true;                             // a skeleton with clipping masks, the masks switched off
    c = counts();
    setClip(false);
    step(1);
    assert.equal(counts().draws, c.draws + 1, 'masks off: redrawn');
    assert.equal(counts().updates, c.updates + 1, '… and re-posed (the eyelid fallback runs in the update)');
    step(10);
    assert.equal(counts().draws, c.draws + 1, 'then held again');
    c = counts();
    v.onDeploy();                                       // b.ev 'deploy'
    v.setDown(null, 70);
    step(6);
    assert.ok(counts().updates >= c.updates + 3, 'standing up: animated again');
  });

  test('direct mode (no impostor): no re-pose while held, the clock still runs', async () => {
    const { v, step, counts } = await operator(0);
    step(2);
    assert.ok(!v.imp, 'drawn directly');
    knockOut(v);
    step(3);
    finish(v.actor);
    step(1);
    const c0 = counts(), clock0 = v.actor.clock;
    step(30);
    assert.equal(counts().updates, c0.updates, 'no update while held');
    assert.ok(Math.abs(v.actor.clock - clock0 - 0.5) < 1e-6, 'clock advanced by the frames\' time');
  });

  test('direct mode: a hit flash on a lying model is updated until its tint is steady on the slots', async () => {
    const { v, step, counts } = await operator(0);
    step(2);
    knockOut(v);
    step(3);
    finish(v.actor);
    step(2);
    const c0 = counts();
    step(10);
    assert.equal(counts().updates, c0.updates, 'held');
    v.flash = 1;                                        // a hit: the tint mixes toward red and fades back over ~10 frames
    step(20);
    const c1 = counts();
    assert.ok(c1.updates > c0.updates, `updated while the tint changes (${c1.updates - c0.updates})`);
    step(10);
    assert.equal(counts().updates, c1.updates, 'held again once the tint is steady');
  });

  test('a living model in the same context keeps its usual refreshes', async () => {
    const { step, counts } = await operator(2);
    step(2);
    const c0 = counts();
    step(20);
    const c1 = counts();
    assert.ok(c1.updates - c0.updates >= 9 && c1.draws - c0.draws >= 9, `every 2nd frame (${c1.updates - c0.updates} updates, ${c1.draws - c0.draws} draws in 20)`);
  });
});
