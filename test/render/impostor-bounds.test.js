// test/render/impostor-bounds.test.js — impostor boxes and slot clipping (GitHub #542, reported by @ImPQlc): on quality
// 高 with many units on the field (round 7 on), 野鬃's flag while idling, 浊心斯卡蒂's head in her S3 flight and 隐现's
// pistol were cut, offset or left stray pixels. A unit's impostor slot was sized from the pose it showed when it first
// became an impostor (plus a margin, render/units.js _impBox); a later pose past it was cut at the slot's edge and painted
// into the neighbouring slots, whose erasers covered only their own slot (render/impostor.js), so what fell outside every
// slot stayed and what fell into another unit's slot showed on that unit until it was redrawn.
// Now every clip a unit plays is measured once per skeleton (render/spine.js clipBounds; sampled within a frame budget by
// stepClipBounds), the box covers them (units.js impostorBox — a clip too large for it is drawn directly while it plays),
// and the atlas draws each slot's skeleton inside a box masked by the slot rectangle (a scissor rect). The setup pose is
// never shown (a model frozen before its first update is posed at its clip's first frame), so the box leaves it out.
// Synthetic Spine 3.8 skeletons (@pixi-spine/runtime-3.8) and the headless fake PIXI (test/render/fakepixi.js); the three
// reported operators through the real runtime: test/render/impostor-bounds-models.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rt = createRequire(path.join(ROOT, 'package.json'))('@pixi-spine/runtime-3.8');

let fake, spine, units, ImpostorAtlas;
before(async () => {
  fake = installFakePixi();
  spine = await import('../../public/js/render/spine.js');
  units = await import('../../public/js/render/units.js');
  ({ ImpostorAtlas } = await import('../../public/js/render/impostor.js'));
});
after(() => fake.restore());

/**
 * A synthetic skeleton: a 100 × 200 body on the root (setup x −50…50, y −200…0 in pixi-spine's y-down world), a 50 × 50
 * flag on the 'arm' bone at x 100 (75…125), a 'flash' slot that is empty in the setup pose, and a 'ghost' slot drawn at
 * alpha 0. Clips: 'Wave' (the arm out to x + 300 at 0.5 s and back), 'Flash' (the flash shown 0.50–0.55 s only, at
 * x 900), 'Ghost' (the ghost bone moved far out: never drawn), 'Still'.
 */
function skeleton() {
  const data = new rt.SkeletonData();
  const bone = (i, name, parent) => { const b = new rt.BoneData(i, name, parent); data.bones.push(b); return b; };
  const root = bone(0, 'root', null), arm = bone(1, 'arm', root), ghostBone = bone(2, 'ghost', root);
  const slot = (i, name, b, att) => { const s = new rt.SlotData(i, name, b); s.attachmentName = att; data.slots.push(s); return s; };
  slot(0, 'body', root, 'body'); slot(1, 'flag', arm, 'flag'); slot(2, 'flash', root, null);
  slot(3, 'ghost', ghostBone, 'ghost').color.a = 0;
  const skin = new rt.Skin('default');
  const region = (name, w, h, x, y) => { const a = new rt.RegionAttachment(name); a.width = w; a.height = h; a.x = x; a.y = y; return a; };
  skin.setAttachment(0, 'body', region('body', 100, 200, 0, 100));
  skin.setAttachment(1, 'flag', region('flag', 50, 50, 100, 0));
  skin.setAttachment(2, 'flash', region('flash', 20, 20, 900, 0));
  skin.setAttachment(3, 'ghost', region('ghost', 10, 10, 0, 0));
  data.skins.push(skin);
  data.defaultSkin = skin;
  const wave = new rt.TranslateTimeline(3);
  wave.boneIndex = 1;
  wave.setFrame(0, 0, 0, 0); wave.setFrame(1, 0.5, 300, 0); wave.setFrame(2, 1, 0, 0);
  const flash = new rt.AttachmentTimeline(3);
  flash.slotIndex = 2;
  flash.setFrame(0, 0, null); flash.setFrame(1, 0.5, 'flash'); flash.setFrame(2, 0.55, null);
  const ghost = new rt.TranslateTimeline(2);
  ghost.boneIndex = 2;
  ghost.setFrame(0, 0, 5000, 0); ghost.setFrame(1, 1, 5000, 0);
  data.animations.push(new rt.Animation('Wave', [wave], 1), new rt.Animation('Flash', [flash], 1),
    new rt.Animation('Ghost', [ghost], 1), new rt.Animation('Still', [], 0));
  return data;
}
const near = (a, b, msg) => { for (let i = 0; i < 4; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-3, `${msg}: [${a}] vs [${b}]`); };
/** Sample every queued clip now. */
const drain = () => { while (spine.pendingClipBounds()) spine.stepClipBounds(Infinity); spine.stepClipBounds(Infinity); };

describe('clip bounds (render/spine.js): what a skeleton draws, measured once per skeleton data', () => {
  test('a clip by every pose it samples — a short-lived attachment counts, an invisible slot does not', () => {
    const data = skeleton();
    const rec = spine.requestClipBounds(data, rt.Skeleton, ['Wave', 'Flash', 'Ghost', 'Still', 'Nope']);
    assert.equal(rec.failed, false);
    assert.equal(rec.setup, undefined, 'no setup pose: no model shows it');
    drain();
    near(rec.rects.get('Wave'), [-50, -200, 425, 25], 'Wave: the flag 300 units out at 0.5 s');
    near(rec.rects.get('Flash'), [-50, -200, 910, 25], 'Flash: shown for 0.05 s of its 1 s, still measured (49 poses)');
    near(rec.rects.get('Ghost'), [-50, -200, 125, 25], 'Ghost: a bone moved 5000 units out with an alpha-0 slot adds nothing');
    near(rec.rects.get('Still'), [-50, -200, 125, 25], 'Still: a 0-s clip is its single pose (the body and the flag)');
    assert.equal(rec.rects.get('Nope'), null, 'a clip the skeleton does not have');
    assert.equal(rec.skel, null, 'the scratch skeleton is dropped once its clips are sampled');
    // the same data again: nothing new to sample
    spine.requestClipBounds(data, rt.Skeleton, ['Wave', 'Flash']);
    assert.equal(spine.pendingClipBounds(), 0);
  });

  test('the queue samples pose by pose within the frame budget — a clip resumes on the next call —, oldest request first', () => {
    const a = skeleton(), b = skeleton();
    const recA = spine.requestClipBounds(a, rt.Skeleton, ['Wave', 'Still']);
    spine.requestClipBounds(b, rt.Skeleton, ['Still']);
    assert.equal(spine.pendingClipBounds(), 3);
    // a spent budget still poses once per call: 'Wave' (1 s: 48 + 1 poses) takes 49 calls
    let calls = 0, finished = 0;
    while (!finished) { finished = spine.stepClipBounds(0); calls++; }
    assert.equal(calls, spine.CLIP_SAMPLE_MAX + 1);
    near(recA.rects.get('Wave'), [-50, -200, 425, 25], 'Wave across 49 calls');
    assert.equal(spine.pendingClipBounds(), 2);
    assert.equal(spine.stepClipBounds(0), 1, 'Still: one pose');
    assert.equal(spine.stepClipBounds(0), 1, 'then the next skeleton\'s');
    assert.equal(spine.pendingClipBounds(), 0);
    assert.equal(spine.stepClipBounds(), 0, 'an empty queue costs nothing');
  });

  test('a record leaves the queue when its last actor is destroyed — pending clips, the clip in progress and its scratch skeleton —; a later actor queues them again', () => {
    const data = skeleton();
    /** A SpineActor stand-in on the real runtime skeleton (clipBounds / destroy are the real methods). */
    const actor = () => Object.assign(Object.create(spine.SpineActor.prototype), { spine: { spineData: data, skeleton: new rt.Skeleton(data), destroy() {} } });
    const a = actor(), b = actor();
    assert.equal(a.clipBounds(['Wave', 'Flash']), null, 'queued');
    assert.equal(b.clipBounds(['Wave', 'Flash']), null);
    spine.stepClipBounds(0);                            // one pose of Wave: a clip in progress
    const rec = spine.requestClipBounds(data, rt.Skeleton, []);
    assert.ok(rec.job && rec.skel, 'sampling Wave on its scratch skeleton');
    a.destroy();
    assert.equal(spine.pendingClipBounds(), 2, 'b still uses the skeleton: still queued');
    b.destroy();                                        // e.g. the battlefield torn down with its units
    assert.equal(spine.pendingClipBounds(), 0, 'nothing left to sample');
    assert.ok(rec.job === null && rec.todo.length === 0 && rec.skel === null, 'no clip in progress, no todo, no scratch skeleton held');
    const c = actor();                                  // the same skeleton in the next scene
    assert.equal(c.clipBounds(['Wave', 'Flash']), null, 'queued again (no todo left behind to block it)');
    assert.equal(spine.pendingClipBounds(), 2);
    drain();
    near(c.clipBounds(['Wave', 'Flash']).get('Wave'), [-50, -200, 425, 25], 'measured');
    c.destroy();
  });

  test('a clip whose sampling throws is recorded as not measurable (false), never as drawing nothing', () => {
    const data = skeleton();
    const wave = data.findAnimation('Wave');
    const apply = wave.apply.bind(wave);
    wave.apply = (skel, last, t, ...rest) => { if (t > 0.5) throw new Error('a broken timeline'); return apply(skel, last, t, ...rest); };
    const rec = spine.requestClipBounds(data, rt.Skeleton, ['Wave', 'Still']);
    drain();
    assert.equal(rec.rects.get('Wave'), false, 'not measurable');
    near(rec.rects.get('Still'), [-50, -200, 125, 25], 'the other clip is measured');
    assert.equal(rec.rects.get('Nope'), undefined);
    const b = units.impostorBox([-50, -200, 125, 25], [['Wave', false, false], ['Still', rec.rects.get('Still'), false]]);
    assert.deepEqual([...b.over], ['Wave'], 'drawn directly while it plays');
  });

  test('SpineActor.clipBounds: null while queued, then a Map clip → rect; false for a runtime that cannot be posed', () => {
    const data = skeleton();
    const stand = { spine: { spineData: data, skeleton: new rt.Skeleton(data) } };
    const clipBounds = spine.SpineActor.prototype.clipBounds;
    assert.equal(clipBounds.call(stand, ['Wave', 'Still']), null, 'queued, not sampled yet');
    drain();
    const b = clipBounds.call(stand, ['Wave', 'Still']);
    assert.deepEqual([...b.keys()], ['Wave', 'Still']);
    near(b.get('Wave'), [-50, -200, 425, 25], 'Wave');
    // the fake PIXI's Spine has a plain-object skeleton: no runtime to pose
    const actor = new spine.SpineActor({ animations: [{ name: 'Idle' }] }, { anims: { idle: 'Idle' }, animations: { Idle: 1 } });
    assert.equal(actor.clipBounds(['Idle']), false);
  });
});

describe('a model frozen before its first update shows its clip\'s first frame, never its setup pose (render/spine.js)', () => {
  const ENTRY = { anims: { idle: 'Idle', die: 'Die', stun: null }, animations: { Idle: 1, Die: 0.8 } };
  /** An actor on the fake PIXI whose skeleton updates are recorded (the dt of each pixi-spine update). */
  function actor(data, entry) {
    const a = new spine.SpineActor(data, entry);
    const posed = [];
    a.spine.update = (dt) => posed.push(dt);
    return { a, posed };
  }

  test('stunned without a stun clip before any update: posed once at t = 0 of its clip, then the pose holds', () => {
    const { a, posed } = actor({ animations: [{ name: 'Idle' }, { name: 'Die' }] }, ENTRY);
    a.setBase('stun');
    assert.equal(a.frozen, true);
    a.update(0.1);
    assert.deepEqual(posed, [0]);
    assert.equal(a.spine.state.tracks[0].animation.name, 'Idle');
    a.update(0.1); a.update(0.1);
    assert.deepEqual(posed, [0], 'held');
    assert.equal(a.poseHeld(), true);
    a.setBase('idle');                                  // the stun ends: animated again
    a.update(0.1);
    assert.deepEqual(posed, [0, 0.1]);
  });

  test('a first update that throws is tried again: the frozen model is posed once an update succeeds', () => {
    const { a, posed } = actor({ animations: [{ name: 'Idle' }, { name: 'Die' }] }, ENTRY);
    let broken = true;
    a.spine.update = (dt) => { posed.push(dt); if (broken) { broken = false; throw new Error('a broken skeleton'); } };
    a.setBase('stun');
    a.update(0.1);                                      // throws inside pixi-spine (caught): not posed yet
    a.update(0.1);                                      // tried again at the clip's first frame: posed
    a.update(0.1);                                      // held
    assert.deepEqual(posed, [0, 0]);
  });

  test('stunned after it was posed: the pose it had holds (unchanged)', () => {
    const { a, posed } = actor({ animations: [{ name: 'Idle' }, { name: 'Die' }] }, ENTRY);
    a.update(0.2);
    a.setBase('stun');
    a.update(0.1); a.update(0.1);
    assert.deepEqual(posed, [0.2]);
  });

  test('dead without a death or idle clip: frozen, and posed once at t = 0 of the clip it had (its first)', () => {
    const { a, posed } = actor({ animations: [{ name: 'Attack' }, { name: 'Move' }] }, { anims: { attack: { begin: null, loop: 'Attack', end: null } }, animations: { Attack: 1, Move: 1 } });
    assert.equal(a.die(), 0, 'no death clip');
    assert.equal(a.frozen, true, 'no idle clip either: frozen');
    a.update(0.5);
    a.update(0.5);
    assert.deepEqual(posed, [0]);
    assert.equal(a.spine.state.tracks[0].animation.name, 'Attack');
  });
});

describe('impostor box (render/units.js impostorBox, playedClips)', () => {
  test('playedClips: every role of the entry and of its forms; one-off = deploy, begin / end of skills, stun, move; a shared name loops', () => {
    const anims = {
      idle: 'Idle', deploy: 'Start', die: 'Die',
      attack: { begin: 'Attack_Begin', loop: 'Attack_Loop', end: 'Attack_End' },
      skill: { begin: 'Skill_2_Begin', loop: 'Skill_2_Loop', end: 'Skill_2_End', idle: 'Skill_2_Idle' },
      skills: { 0: { begin: 'Skill_1_Begin', loop: 'Skill_1_Loop', end: null, idle: null }, 1: { begin: 'Skill_2_Begin', loop: 'Skill_2_Loop', end: 'Skill_2_End', idle: 'Skill_2_Idle' } },
      move: { begin: 'Move_Begin', loop: 'Move_Loop', end: 'Move_End' }, run: { loop: 'Run_Loop' },
      stun: { begin: 'Stun_Begin', loop: 'Stun', end: null }, attackDown: { loop: 'Attack_Down' },
    };
    const m = units.playedClips(anims, units.FORMS.char_4016_kazema);
    const once = [...m].filter(([, o]) => o).map(([n]) => n).sort();
    const loops = [...m].filter(([, o]) => !o).map(([n]) => n).sort();
    assert.deepEqual(once, ['Move_Begin', 'Move_End', 'Skill_1_Begin', 'Skill_2_Begin', 'Skill_2_End', 'Start', 'Start_B', 'Stun_Begin']);
    assert.deepEqual(loops, ['Attack_B', 'Attack_Begin', 'Attack_End', 'Attack_Loop', 'Die', 'Die_B', 'Idle', 'Idle_B', 'Move_Loop', 'Run_Loop', 'Skill_1_Loop', 'Skill_2_Idle', 'Skill_2_Loop', 'Stun']);
    assert.ok(!m.has('Attack_Down'), 'attackDown is no clip the renderer plays');
    // a name that is the deploy clip and the idle clip loops
    assert.equal(units.playedClips({ idle: 'Idle', deploy: 'Idle' }).get('Idle'), false);
    assert.equal(units.playedClips(null).size, 0);
  });

  const box = (b) => [b.x0, b.y0, b.x0 + b.w, b.y0 + b.h];
  const inside = (outer, r) => outer[0] <= r[0] && outer[1] <= r[1] && outer[2] >= r[2] && outer[3] >= r[3];

  test('the idle clip always; then each clip while the box stays within 5× (looping) / 2× (one-off) of that core', () => {
    const idle = [-150, -380, 120, 10];                                     // the core: 270 × 390
    const clips = [
      ['Attack', [-150, -420, 400, 10], false],    // 550 × 430 = 2.2 × the core: looping, taken
      ['Skill', [-300, -500, 120, 10], false],     // with the attack 700 × 510 = 3.4 ×: taken
      ['Start', [-100, -1800, 100, 0], true],      // a drop from above: 1810 tall, one-off, 12 ×: drawn directly
      ['Die', [-120, -200, 90, 5], false],         // inside the box anyway
      ['Huge', [-3000, -400, 3000, 0], false],     // a screen-wide effect: past 5 ×, left out
      ['Gone', null, true],                        // draws nothing
    ];
    const b = units.impostorBox(idle, clips);
    const r = box(b);
    assert.ok(inside(r, idle), 'never smaller than the idle clip');
    for (const n of ['Attack', 'Skill', 'Die']) assert.ok(inside(r, clips.find((c) => c[0] === n)[1]), `${n} inside the box`);
    assert.deepEqual([...b.over].sort(), ['Huge', 'Start'], 'the clips drawn directly while they play');
    // padding: 3 % of the longer side (700) + 8 units on every side
    const pad = 0.03 * 700 + 8;
    near(r, [-300 - pad, -500 - pad, 400 + pad, 10 + pad], 'padded box');
  });

  test('a one-off clip fits under the 2× limit, a looping one up to 5×; a clip inside the box is never left out', () => {
    const core = [-100, -100, 100, 100];                        // area 40000
    const once = units.impostorBox(core, [['Begin', [-100, -260, 100, 100], true]]);     // 1.8 ×
    assert.equal(once.over.size, 0);
    const tooBig = units.impostorBox(core, [['Begin', [-100, -340, 100, 100], true]]);   // 2.2 ×
    assert.deepEqual([...tooBig.over], ['Begin']);
    const loop = units.impostorBox(core, [['Loop', [-100, -800, 100, 100], false]]);     // 4.5 ×
    assert.equal(loop.over.size, 0);
    const loopTooBig = units.impostorBox(core, [['Loop', [-100, -1000, 100, 100], false]]);   // 5.5 ×
    assert.deepEqual([...loopTooBig.over], ['Loop']);
    // ordered by the area they add: Begin first (left out at 3 ×), then the loop, whose box covers Begin after all
    const both = units.impostorBox(core, [['Begin', [-100, -500, 100, 100], true], ['Loop', [-100, -660, 100, 100], false]]);
    assert.equal(both.over.size, 0, 'Begin lies inside the box the loop made');
  });

  test('without an idle clip that draws anything the looping clips make the core; nothing drawn → null', () => {
    const b = units.impostorBox(null, [['Attack', [-10, -50, 30, 0], false], ['Start', [-10, -900, 10, 0], true]]);
    assert.deepEqual([...b.over], ['Start']);
    assert.ok(b.w > 40 && b.h > 50 && b.h < 100);
    assert.equal(units.impostorBox(null, [['Start', null, true]]), null);
    assert.equal(units.impostorBox([NaN, 0, 1, 1], []), null);
  });
});

describe('impostor atlas (render/impostor.js): every slot is cleared and clipped to itself', () => {
  /** An atlas on the fake PIXI with a renderer that records what each page render contained. */
  function atlas() {
    const renders = [];
    const R = { resolution: 1, render: (obj, o) => renders.push({ clear: o.clear, boxes: obj.children[1].children.filter((b) => b.visible).length }) };
    return { imp: new ImpostorAtlas(R), renders };
  }

  test('a slot owns an eraser and a box masked by exactly its rectangle (PIXI draws a rectangle mask as a scissor rect)', () => {
    const { imp } = atlas();
    const drawn = [];
    const drawRect = fake.P.Graphics.prototype.drawRect;
    fake.P.Graphics.prototype.drawRect = function (x, y, w, h) { drawn.push(this); this.rect = [x, y, w, h]; return this; };
    try {
      const a = imp.alloc(100, 110), b = imp.alloc(60, 40);
      for (const s of [a, b]) {
        assert.deepEqual(s.mask.rect, [s.x, s.y, s.w, s.h], 'mask = the slot');
        assert.equal(s.box.mask, s.mask);
        assert.equal(s.mask.parent, s.box, 'the mask lives in the box (its transform follows the page)');
        assert.deepEqual([s.eraser.x, s.eraser.y, s.eraser.width, s.eraser.height], [s.x, s.y, s.w, s.h], 'the eraser clears all of it');
        assert.equal(s.box.visible, false, 'nothing drawn until queued');
      }
      assert.equal(drawn.length, 2);
    } finally { fake.P.Graphics.prototype.drawRect = drawRect; }
  });

  test('a queued skeleton is drawn inside its slot box, then parked; freeing a slot never destroys a skeleton queued in it', () => {
    const { imp, renders } = atlas();
    const s = imp.alloc(100, 110), t = imp.alloc(100, 110);
    const body = new fake.P.Container(), other = new fake.P.Container();
    imp.park(body); imp.park(other);
    imp.draw(s, body, { a: 0.3, d: 0.3, tx: 40, ty: 90 });
    assert.equal(body.parent, s.box);
    assert.ok(s.box.visible && s.eraser.visible && !t.box.visible);
    assert.deepEqual([body.x, body.y], [s.x + 40, s.y + 90]);
    imp.flush();
    assert.deepEqual(renders, [{ clear: true, boxes: 1 }], 'one render of the page: the queued slot only');
    assert.equal(body.parent, imp.parked);
    assert.ok(!s.box.visible && !s.eraser.visible && !body.visible);
    imp.draw(t, other, { a: 1, d: 1, tx: 0, ty: 0 });
    imp.free(t);                                        // its unit left impostor mode before the flush
    assert.ok(!other.destroyed && other.parent === imp.parked, 'the skeleton went back to the lot');
    assert.ok(t.box.destroyed, 'the box and its mask are gone');
    imp.flush();
    assert.deepEqual(renders.at(-1), { clear: false, boxes: 0 }, 'later passes do not clear the page');
  });
});

describe('UnitView impostor mode (render/units.js)', () => {
  const tick = () => new Promise((r) => setImmediate(r));
  const cam = () => presetCamera('normal', { width: 1280, height: 720 });
  const ENTRY = { skel: '/s/op.skel', atlas: '/s/op.atlas', textures: ['/s/op.png'], anims: { idle: 'Idle', deploy: 'Start', die: 'Die', attack: { begin: null, loop: 'Attack', end: null } }, animations: { Idle: 1, Start: 1, Die: 0.8, Attack: 1 } };
  const DATA = { animations: [{ name: 'Idle' }, { name: 'Start' }, { name: 'Die' }, { name: 'Attack' }] };
  const MEASURED = new Map([['Idle', [-70, -210, 70, 0]], ['Attack', [-70, -230, 180, 0]], ['Start', [-70, -1800, 70, 0]], ['Die', [-120, -150, 90, 0]]]);

  /**
   * An operator in a crowd (impostor interval 2) with a recording fake atlas; `bounds()` = what clipBounds answers;
   * `flags` = its unit flags while the model loads (UF.STUNNED: the model is built for a stunned unit).
   */
  async function operator(bounds, flags = 0) {
    let frame = 0;
    const log = { alloc: 0, free: 0, draw: 0 };
    const atlas = {
      alloc: (w, h, o) => { log.alloc++; return { w, h, tex: new fake.P.Texture(), clip: !!o?.clip }; },
      free() { log.free++; }, park(o) { o.visible = false; }, unpark(o) { o.visible = true; }, draw() { log.draw++; },
    };
    const ctx = fakeViewCtx(fake.P, {
      cam, frameNo: () => frame, impostors: atlas, impostorInterval: () => 2,
      renderer: { resolution: 1, render() {} },
      assets: { picture: () => null, image: async () => null, spineEntry: () => ENTRY, spine: { acquire: async () => DATA, release() {} } },
    });
    const v = new units.UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId: 'char_x', tier: 3, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT' });
    v.flags = flags;
    await tick(); await tick();
    assert.ok(v.spineReady, 'spine ready');
    v.actor.clipBounds = (names) => {
      const b = bounds();
      if (b) for (const n of names) assert.ok(b.has(n), `${n} measured`);
      return b;
    };
    const step = (n = 1) => { for (let i = 0; i < n; i++) { v.update(1 / 60, cam(), frame / 60); frame++; } };
    return { v, step, log };
  }

  test('while the model\'s clips are still measured the unit is drawn directly; then an impostor sized from them', async () => {
    let ready = null;
    const { v, step, log } = await operator(() => ready);
    step(4);
    assert.ok(!v.imp, 'no impostor without a box');
    assert.equal(log.draw, 0);
    assert.equal(v.actor.spine.parent, v.body, 'drawn directly');
    ready = MEASURED;
    step(2);
    assert.ok(v.imp && log.draw >= 1, 'an impostor once measured');
    const b = v._box, r = [b.x0, b.y0, b.x0 + b.w, b.y0 + b.h];
    for (const n of ['Idle', 'Attack', 'Die']) {
      const c = MEASURED.get(n);
      assert.ok(r[0] <= c[0] && r[1] <= c[1] && r[2] >= c[2] && r[3] >= c[3], `${n} inside the box`);
    }
    assert.deepEqual([...b.over], ['Start'], 'the deploy drop is drawn directly while it plays');
  });

  test('a clip too large for the box is drawn directly while it plays — the slot stays the unit\'s — and redrawn into it after', async () => {
    const { v, step, log } = await operator(() => MEASURED);
    step(4);
    const sprite = v.imp.sprite;
    assert.ok(v.imp && sprite.visible);
    const c0 = { ...log };
    v.onDeploy();                                       // b.ev 'deploy': the Start clip
    step(1);
    assert.equal(v.imp.bypass, true);
    assert.equal(sprite.visible, false, 'the impostor sprite hides');
    assert.equal(v.actor.spine.parent, v.body, 'the skeleton is drawn in the body');
    assert.equal(v.actor.spine.visible, true);
    step(30);
    assert.equal(log.draw, c0.draw, 'no atlas redraw while it plays');
    assert.equal(log.free, c0.free, 'its slot is kept');
    step(40);                                           // the 1-s clip is over: back to the idle
    assert.equal(v.imp.bypass, false);
    assert.ok(sprite.visible && v.actor.spine.parent !== v.body, 'the impostor again');
    assert.ok(log.draw > c0.draw, 'redrawn into its slot');
    assert.equal(log.alloc, c0.alloc, 'the same slot');
  });

  test('a clip whose sampling threw is drawn directly while it plays — the attack, or even the idle clip —, never cut by the slot', async () => {
    const broken = new Map(MEASURED).set('Attack', false);
    const { v, step, log } = await operator(() => broken);
    step(3);
    assert.ok(v.imp && v._box.over.has('Attack'));
    const draws = log.draw;
    v.actor._play('Attack', false, { mix: 0 });
    step(2);
    assert.equal(v.imp.bypass, true, 'the attack is drawn directly');
    assert.equal(log.draw, draws, 'not into the slot');
    const idleBroken = new Map(MEASURED).set('Idle', false);
    const w = (await operator(() => idleBroken)).v;
    w.update(1 / 60, cam(), 0);
    assert.ok(w._box.over.has('Idle'), 'an unmeasurable idle clip: drawn directly while it idles');
    const b = w._box, c = MEASURED.get('Attack');
    assert.ok(b.x0 <= c[0] && b.x0 + b.w >= c[2], 'the box built from the clips that were measured');
    const none = new Map([...MEASURED.keys()].map((n) => [n, false]));
    const z = (await operator(() => none)).v;
    z.update(1 / 60, cam(), 0);
    assert.deepEqual([...z._box.over].sort(), ['Attack', 'Die', 'Idle', 'Start'], 'nothing measurable: every clip drawn directly');
  });

  test('a runtime whose clips cannot be measured keeps the box from the pose shown (the pre-#542 rule)', async () => {
    const { v, step } = await operator(() => false);
    step(3);
    assert.ok(v.imp, 'impostor');
    assert.deepEqual([v._box.x0, v._box.y0, v._box.w, v._box.h], [-140, -260, 280, 290], 'fake getLocalBounds (−50, −100, 100 × 100) + the old margins');
    assert.equal(v._box.over.size, 0);
  });

  test('built while stunned without a stun clip: posed once at its idle clip\'s first frame — the box\'s core —, then held', async () => {
    const { v, step, log } = await operator(() => MEASURED, 2);   // UF.STUNNED
    assert.equal(v.actor.frozen, true, 'no stun clip: the pose freezes');
    const posed = [];
    v.actor.spine.update = (dt) => posed.push(dt);
    step(6);
    assert.deepEqual(posed, [0], 'one pose at t = 0 of the clip on its track, never the setup pose');
    assert.equal(v.actor.spine.state.tracks[0].animation.name, 'Idle');
    assert.ok(v.imp && log.draw === 1, 'drawn into its slot once, then held');
    const b = v._box, c = MEASURED.get('Idle');
    assert.ok(b.x0 <= c[0] && b.y0 <= c[1] && b.x0 + b.w >= c[2] && b.y0 + b.h >= c[3], 'that frame lies inside the box');
  });

  test('a skeleton without an Idle clip: the clip SpineActor idles on instead (its first) is the box\'s core', async () => {
    const entry = { ...ENTRY, anims: { attack: { begin: null, loop: 'Attack', end: null } }, animations: { Attack: 1, Move: 1 } };
    const ctx = fakeViewCtx(fake.P, {
      cam, frameNo: () => 0, impostors: { alloc: (w, h) => ({ w, h, tex: new fake.P.Texture(), clip: false }), free() {}, park(o) { o.visible = false; }, unpark(o) { o.visible = true; }, draw() {} },
      renderer: { resolution: 1, render() {} },
      assets: { picture: () => null, image: async () => null, spineEntry: () => entry, spine: { acquire: async () => ({ animations: [{ name: 'Attack' }, { name: 'Move' }] }), release() {} } },
    });
    const v = new units.UnitView(ctx, { id: 2, side: 'ally', kind: 'chess', defId: 'char_y', tier: 1, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT' });
    await tick(); await tick();
    assert.equal(v.actor.spine.state.tracks[0].animation.name, 'Attack', 'SpineActor idles on the first clip');
    assert.equal(v._idleClip(), 'Attack');
    assert.deepEqual([...v._clipNames()], [['Attack', false]]);
  });

  test('a pen figure (lod idle) needs its idle clip only', async () => {
    let asked = null;
    const ctx = fakeViewCtx(fake.P, {
      cam, frameNo: () => 0, impostors: { alloc: (w, h) => ({ w, h, tex: new fake.P.Texture(), clip: false }), free() {}, park(o) { o.visible = false; }, unpark(o) { o.visible = true; }, draw() {} },
      renderer: { resolution: 1, render() {} },
      assets: { picture: () => null, image: async () => null, spineEntry: () => ENTRY, spine: { acquire: async () => DATA, release() {} } },
    });
    const v = new units.UnitView(ctx, { id: 'e:0', side: 'enemy', kind: 'enemy', defId: 'enemy_x', tier: 1, x: 9, y: 15, maxHp: 1, facing: -1 }, { prep: true, lod: 'idle' });
    await tick(); await tick();
    v.actor.clipBounds = (names) => { asked = names; return MEASURED; };
    v.update(1 / 60, cam(), 0);
    assert.deepEqual(asked, ['Idle']);
    assert.ok(v.imp && v._box.over.size === 0);
  });
});
