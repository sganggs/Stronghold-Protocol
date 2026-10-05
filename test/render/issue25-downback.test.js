// test/render/issue25-downback.test.js — GitHub issue #25 「部分干员被击倒后在部署状态时仍有攻击动作」, client side: an
// operator facing UP shows its Back model, and 131 of the 135 Back skeletons have no Die clip, so a knocked-out one went
// on with its looping attack / skill / idle clip under the redeploy ring (a front-facing one lay down). Now it falls and
// lies with its Front model (render/units.js _wantsBack / _syncModel), stands up again with the Back model (the deploy
// clip carried over), a Back skeleton with a fall of its own keeps it, and a skeleton without a Die clip holds still
// (render/spine.js SpineActor.die). Headless fake PIXI (test/render/fakepixi.js) with the real manifest entries
// (data/assets.json) and the real asset helpers (public/js/assets.js spineEntry / hasBackSpine). DESIGN §22.1.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { spineEntry, hasBackSpine } from '../../public/js/assets.js';
import { ANIM } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const M = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const CAPER = 'char_4100_caper';   // 跃跃: the operator of the report, no Die clip in its Back skeleton
const MINT = 'char_388_mint';      // one of the 4 Back skeletons with a Die clip

let fake, UnitView, DOWN_STATE, DOWN_LOOK, dieClipDur, SpineActor;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, DOWN_STATE, DOWN_LOOK, dieClipDur } = await import('../../public/js/render/units.js'));
  ({ SpineActor } = await import('../../public/js/render/spine.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { await tick(); await tick(); };
const cam = () => presetCamera('normal', { width: 1280, height: 720 });
let clockT = 0;
const frames = (v, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) { clockT += dt; v.update(dt, cam(), clockT); } };

/** The real manifest behind the asset store's helpers; acquire / release counted per skeleton. */
function store() {
  const refs = new Map();
  let acquired = 0;
  return {
    refs, acquired: () => acquired,
    picture: () => null,
    image: async () => null,
    hasBack: (id) => hasBackSpine(M, id),
    spineEntry: (id, o) => spineEntry(M, id, o),
    spine: {
      acquire: async (e) => { acquired++; refs.set(e.skel, (refs.get(e.skel) || 0) + 1); return { animations: Object.keys(e.animations || {}).map((name) => ({ name })) }; },
      release: (e) => { refs.set(e.skel, (refs.get(e.skel) || 0) - 1); },
    },
  };
}
const held = (s) => [...s.refs].filter(([, n]) => n !== 0);

async function op(id, dir, s = store(), extra = {}) {
  const v = new UnitView(fakeViewCtx(fake.P, { assets: s, cam }), { id: 5, side: 'ally', kind: 'chess', defId: id, spine: id, tier: 1, x: 5, y: 10, maxHp: 1000, dir, ...extra });
  await settle();
  frames(v, 5);
  return v;
}
const front = (id) => M.chars[id].spine.front;
const back = (id) => M.chars[id].spine.back;
const DOWN = (t = 1) => [5, t + 60, 60, DOWN_STATE.COUNTING, 10, 5];

describe('the manifest (data/assets.json)', () => {
  test('most Back skeletons have no fall, every operator Front skeleton has one', () => {
    const backs = Object.entries(M.chars).filter(([, c]) => c.spine?.back);
    const withFall = backs.filter(([, c]) => dieClipDur(c.spine.back) > 0).map(([id]) => id).sort();
    assert.ok(backs.length >= 130, `${backs.length} Back skeletons`);
    // The four known pool Backs keep their own fall; the DIY (甄选) catalog adds a few more (老鲤, 丰川祥子) —
    // the point of the test is that a Back with a fall is the exception, so pin the fixture and the share, not the list.
    for (const id of ['char_388_mint', 'char_4064_mlynar', 'char_440_pinecn', 'char_602_cdfend']) assert.ok(withFall.includes(id), `${id} Back has a Die clip`);
    assert.ok(withFall.length <= Math.max(8, Math.round(backs.length / 12)), `only few Backs carry a fall (${withFall.length}/${backs.length})`);
    // A DIY (甄选) candidate whose art a community dump lacks has no Front entry at all (best-effort, docs/ASSETS.md);
    // every Front the manifest DOES list carries a Die clip.
    for (const [id, c] of Object.entries(M.chars)) if (c.spine?.front) assert.ok(dieClipDur(c.spine.front) > 0, `${id} Front has a Die clip`);
    assert.equal(dieClipDur(back(CAPER)), 0);
    assert.equal(dieClipDur(front(CAPER)), front(CAPER).animations.Die);
    assert.equal(dieClipDur(null), 0);
    assert.equal(dieClipDur({ anims: { die: null }, animations: { Die: 0.8 } }), 0.8, 'a Die clip the roles did not name');
  });
});

describe('an operator facing UP knocked out (Back model without a Die clip)', () => {
  test('mid-attack: the Back model stops at once, then the Front model falls and holds its Die pose under the ring', async () => {
    const s = store();
    const v = await op(CAPER, 'UP', s);
    assert.equal(v.entryBack, true);
    assert.equal(v.actor.entry, back(CAPER), 'standing: the Back model');
    v.onAttack(null, 1, 'none');
    assert.equal(v.actor.current, 'Attack');
    const n0 = s.acquired();
    v.setDown(DOWN(), 1);                                // b.snap down: knocked out mid-attack
    assert.equal(v.alive, false);
    // until the Front model is there the Back model holds the first frame of its idle — no attack loop
    assert.equal(v.actor.entry, back(CAPER));
    assert.equal(v.actor.current, 'Idle');
    assert.equal(v.actor.spine.state.tracks[0].timeScale, 0, 'held still');
    v.onAttack(null, 1.2, 'none');                       // a late 'atk' of the same frame
    assert.equal(v.windUp(0.1, 'none'), false);
    assert.equal(v.actor.current, 'Idle', 'nothing restarts the attack');
    assert.equal(s.acquired(), n0, 'nothing loads before the frame\'s update');
    frames(v, 1);
    assert.equal(v.entryBack, false, 'the Front model requested');
    assert.equal(v.actor.current, 'Idle', 'the Back model holds still while it loads');
    await settle();
    assert.equal(v.actor.entry, front(CAPER), 'the Front model in place');
    assert.equal(v.actor.current, 'Die');
    assert.equal(v.swapT, 1, 'swapped in place (no fallback diamond)');
    frames(v, 180);                                      // 3 s down
    assert.equal(v.actor.current, 'Die', 'the Die pose is held');
    assert.ok(v.actor.clock >= front(CAPER).animations.Die, 'past the end of the fall');
    assert.ok(v._downRing.root.visible, 'under the redeploy ring');
    assert.equal(v.actor.spine.tint, DOWN_LOOK.tint, 'the Front model greyed like any knocked-down one');
    assert.equal(v.remove, false);
    assert.deepEqual(held(s), [[front(CAPER).skel, 1]], 'the Back model released, the Front one held');
    v.destroy();
    await settle();
    assert.deepEqual(held(s), [], 'every acquire paired with a release');
  });

  test('every operator of the report (跃跃, 拉普兰德, 异德 = 缄默德克萨斯, 斯卡蒂, 德克萨斯) lies down with its Front model\'s Die', async () => {
    for (const id of [CAPER, 'char_140_whitew', 'char_1028_texas2', 'char_263_skadi', 'char_102_texas']) {
      assert.equal(dieClipDur(back(id)), 0, `${id}: no Die clip in its Back skeleton`);
      const v = await op(id, 'UP');
      v.onAttack(null, 1, 'none');
      v.setDown(DOWN(), 1);
      frames(v, 1);
      await settle();
      frames(v, 120);
      assert.equal(v.actor.entry, front(id), id);
      assert.equal(v.actor.current, front(id).anims.die, id);
      v.destroy();
    }
  });

  test('facing RIGHT it falls with its Front model as before (one model, no swap)', async () => {
    const s = store();
    const v = await op(CAPER, 'RIGHT', s);
    v.onAttack(null, 1, 'none');
    const a = v.actor;
    v.setDown(DOWN(), 1);
    assert.equal(a.current, 'Die');
    frames(v, 2);
    await settle();
    assert.equal(v.actor, a, 'the same model');
    assert.equal(s.acquired(), 1);
  });

  test('the redeploy: the Back model again, its deploy clip carried over from the Front model', async () => {
    const s = store();
    const v = await op(CAPER, 'UP', s);
    v.setDown(DOWN(), 1);
    frames(v, 1);
    await settle();
    frames(v, 60);
    assert.equal(v.actor.entry, front(CAPER));
    v.onDeploy();                                        // b.ev 'deploy' (timed, 不屈, 阿戈尔: every redeploy)
    assert.equal(v.alive, true);
    assert.equal(v.actor.current, 'Start', 'the Front model starts the deploy clip');
    frames(v, 3);
    assert.equal(v.entryBack, true, 'the Back model requested');
    await settle();
    assert.equal(v.actor.entry, back(CAPER), 'standing facing UP: the Back model');
    assert.equal(v.actor.current, 'Start', 'the deploy clip goes on on the Back model');
    assert.equal(v.actor.mode, 'deploy');
    assert.ok(Math.abs(v.actor.deployElapsed() - 3 / 60) < 1e-9, 'where the Front model was in it');
    frames(v, 70);
    assert.equal(v.actor.current, 'Idle');
    assert.equal(v.actor.spine.tint, 0xffffff, 'not greyed any more');
    v.onAttack(null, 9, 'none');
    assert.equal(v.actor.current, 'Attack', 'it attacks again');
    assert.equal(v.down, null);
    v.destroy();
    await settle();
    assert.deepEqual(held(s), []);
  });

  test('the snapshot\'s DIE anim (no die event) and a revive from the snapshot go the same way', async () => {
    const s = store();
    const v = await op(CAPER, 'UP', s);
    const sample = (anim, hp) => ({ x: 5, y: 10, hp, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim, vx: 0, vy: 0 });
    v.sync(sample(ANIM.DIE, 0), 2);
    frames(v, 1);
    await settle();
    assert.equal(v.actor.entry, front(CAPER));
    assert.equal(v.actor.current, 'Die');
    v.revive();                                          // render/app.js syncBattle: alive again without an event
    v.sync(sample(ANIM.IDLE, 1000), 3);
    frames(v, 1);
    await settle();
    assert.equal(v.actor.entry, back(CAPER));
    assert.equal(v.actor.current, 'Idle');
  });

  test('a death and a redeploy in one frame (不屈, a 突袭 jump, a backlog after a hidden tab) load nothing', async () => {
    const s = store();
    const v = await op(CAPER, 'UP', s);
    const a = v.actor, n0 = s.acquired();
    v.die();                                             // b.ev 'die' …
    v.onDeploy();                                        // … and 'deploy' handed out in the same frame
    frames(v, 2);
    await settle();
    assert.equal(s.acquired(), n0, 'no model loaded');
    assert.equal(v.actor, a, 'the Back model stays');
    assert.equal(v.actor.current, 'Start');
    assert.equal(v.alive, true);
  });

  test('a view built for one already down (a field entered late, a re-entry after a hidden tab) lies with the Front model at the end of its fall', async () => {
    const s = store();
    const v = new UnitView(fakeViewCtx(fake.P, { assets: s, cam }), { id: 5, side: 'ally', kind: 'chess', defId: CAPER, spine: CAPER, tier: 1, x: 5, y: 10, maxHp: 1000, dir: 'UP' });
    v.setDown(DOWN(30), 30, true);                       // render/app.js syncBattle: made on the spot, `fresh`
    frames(v, 1);
    await settle();
    assert.equal(v.actor.entry, front(CAPER));
    assert.equal(v.actor.current, 'Die');
    assert.ok(v.actor.clock >= front(CAPER).animations.Die, 'the held end, no fall');
    assert.deepEqual(held(s), [[front(CAPER).skel, 1]], 'the Back model asked for at construction was released unseen');
  });

  test('an operator entering 联防 knocked out (deploy + die FORCED_EXIT in one batch): the Front model\'s held pose', async () => {
    const s = store();
    const v = new UnitView(fakeViewCtx(fake.P, { assets: s, cam }), { id: 5, side: 'ally', kind: 'chess', defId: CAPER, spine: CAPER, tier: 1, x: 5, y: 10, maxHp: 1000, dir: 'UP' });
    v.onDeploy();
    v.die(true);
    v.setDown(DOWN(0.03), 0.03);
    frames(v, 1);
    await settle();
    assert.equal(v.actor.entry, front(CAPER));
    assert.equal(v.actor.current, 'Die');
    assert.ok(v.actor.clock >= front(CAPER).animations.Die);
  });

  test('withdrawn (no `down` entry): the Front model\'s fall times the fade, as for one facing RIGHT', async () => {
    const up = await op(CAPER, 'UP');
    const right = await op(CAPER, 'RIGHT');
    up.die(); right.die();
    assert.ok(up.dieDur > 1.5 && up.dieDur === right.dieDur, `${up.dieDur} = ${right.dieDur}`);
    frames(up, 1);
    await settle();
    assert.equal(up.actor.current, 'Die');
    frames(up, 120);
    assert.equal(up.remove, true, 'faded out');
  });

  test('a Back skeleton with a fall of its own keeps it (薄绿)', async () => {
    const s = store();
    const v = await op(MINT, 'UP', s);
    const a = v.actor, n0 = s.acquired();
    v.setDown(DOWN(), 1);
    frames(v, 2);
    await settle();
    assert.equal(v.actor, a, 'the Back model stays');
    assert.equal(v.actor.entry, back(MINT));
    assert.equal(v.actor.current, 'Die');
    assert.equal(s.acquired(), n0);
  });
});

describe('the safety net: a skeleton without a Die clip (SpineActor.die)', () => {
  const actor = (entry) => new SpineActor({ animations: Object.keys(entry.animations).map((name) => ({ name })) }, entry);

  test('holds the first frame of its idle; no attack, skill, form or stun moves it; a revive plays again', () => {
    const a = actor(back(CAPER));
    a.attack(1);
    assert.equal(a.current, 'Attack');
    assert.equal(a.die(), 0, 'no clip to time');
    assert.equal(a.current, 'Idle');
    assert.equal(a.spine.state.tracks[0].timeScale, 0);
    assert.equal(a.mode, 'die');
    a.attack(1);
    assert.equal(a.windUp(1, 0.1), false);
    a.setSkill(true);
    a.setBase('move'); a.setBase('stun');
    a.setForm({ idle: 'Skill_Idle' }, 'Skill_Begin');
    a.update(5);
    assert.equal(a.current, 'Idle');
    assert.equal(a.spine.state.tracks[0].timeScale, 0);
    a.setForm(null);
    a.revive();
    assert.equal(a.current, 'Idle');
    assert.equal(a.spine.state.tracks[0].timeScale, 1, 'moving again');
    assert.equal(a.spine.state.tracks[0].loop, true);
  });

  test('without an idle clip either it freezes; a revive thaws it; a skeleton with a Die clip plays it', () => {
    const a = actor({ anims: { idle: null, attack: { begin: null, loop: 'Attack', end: null } }, animations: { Attack: 1 } });
    a.attack(1);
    a.die();
    assert.equal(a.frozen, true);
    assert.equal(a.current, 'Attack', 'the pose it had');
    a.revive();
    assert.equal(a.frozen, false);
    const b = actor(front(CAPER));
    assert.equal(b.die(), front(CAPER).animations.Die);
    assert.equal(b.current, 'Die');
    assert.equal(b.spine.state.tracks[0].timeScale, 1);
  });
});

describe('enemies and summons are unchanged', () => {
  test('an enemy dies on its own model (no swap); an idle-only summon facing UP holds still and fades', async () => {
    const s = store();
    const e = new UnitView(fakeViewCtx(fake.P, { assets: s, cam }), { id: 7, side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime', spine: 'enemy_1007_slime', tier: 1, x: 8, y: 9, maxHp: 100, facing: -1 });
    await settle();
    const ea = e.actor;
    e.die();
    frames(e, 2);
    await settle();
    assert.equal(e.actor, ea);
    assert.equal(e.actor.current, 'Die');
    const tok = 'token_10017_skadi2_dedant';   // 浊心斯卡蒂's 海嗣: Idle / Skill / Start, no Die clip, no Back model
    const t = new UnitView(fakeViewCtx(fake.P, { assets: s, cam }), { id: 8, side: 'ally', kind: 'token', defId: tok, spine: tok, tier: 1, x: 4, y: 9, maxHp: 100, dir: 'UP' });
    await settle();
    assert.equal(t.entryBack, false);
    const ta = t.actor, n0 = s.acquired();
    t.onAttack(null, 1, 'none');
    t.die();
    assert.equal(ta.current, 'Idle');
    assert.equal(ta.spine.state.tracks[0].timeScale, 0, 'held still while it fades');
    frames(t, 90);
    assert.equal(t.remove, true);
    assert.equal(s.acquired(), n0, 'no model loaded');
    assert.equal(t.actor, ta);
  });
});
