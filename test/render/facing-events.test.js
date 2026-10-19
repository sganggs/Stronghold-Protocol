// Operator model facing, end to end through the renderer's own event path (#730 review by the maintainer).
//
// The look-ahead groups the queued `atk` events with render/facing.js attackGroups() — one attack = one source at one
// event time — and only a single-target attack whose wind-up was ACCEPTED turns the model. These tests build the real
// SnapshotBuffer, feed real event tuples, and drive the real UnitView (fake PIXI stands in for the renderer), so they
// cover the wiring the review asked for: a fast single-target attacker, a 群攻 attack, a delayed batch, a held (stunned)
// operator, and a Front ⇄ Back switch while a skill clip is on.
//   node --test test/render/facing-events.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { SnapshotBuffer } from '../../public/js/render/interp.js';

let fake, UnitView, attackGroups, FACING_TURN_S;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
  ({ attackGroups, FACING_TURN_S } = await import('../../public/js/render/facing.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('prep', { width: 1280, height: 720 });

/** Asset store with a Front and a Back model (the Back one for UP), plus a skill loop on the Front model. */
function store() {
  const front = {
    skel: '/s/front.skel', atlas: '/s/front.atlas',
    anims: { idle: 'Idle', attack: { loop: 'Attack' }, skill: { loop: 'Attack' }, deploy: 'Start' },
    animations: { Idle: 1, Attack: 1, Start: 1 }, hits: { Attack: [0.4] },
  };
  const back = {
    skel: '/s/back.skel', atlas: '/s/back.atlas',
    anims: { idle: 'Idle', attack: { loop: 'Attack' }, skill: { loop: 'Attack' }, deploy: 'Start' },
    animations: { Idle: 1, Attack: 1, Start: 1 }, hits: { Attack: [0.4] },
  };
  const log = [];
  return {
    log, front, back,
    picture: () => null,
    image: async () => null,
    hasBack: () => true,
    spineEntry: (id, o) => { const backWanted = !!(o && o.back); log.push(backWanted); return backWanted ? back : front; },
    spine: { acquire: async () => ({ animations: [{ name: 'Idle' }, { name: 'Attack' }, { name: 'Start' }] }), release: () => {} },
  };
}

/** An ally view at (4, 9) that has its model loaded (the load is async: `await ready()`). */
async function ally(info = {}, assets = store()) {
  const ctx = fakeViewCtx(fake.P, { assets, cam });
  const v = new UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId: 'char_x', spine: 'char_x', tier: 3, x: 4, y: 9, maxHp: 1000, dir: 'RIGHT', ...info });
  await tick(); await tick();
  return { v, assets };
}

/** A lone target view (nothing to load: `battleView` targets are only read for x / y). */
const at = (x, y) => ({ x, y });

/** Advance the view's frame clock in 1/60 s steps (the turnaround runs in update()). */
function run(v, seconds, dt = 1 / 60) {
  const camera = cam();
  for (let t = 0; t < seconds - 1e-9; t += dt) v.update(dt, camera, 0);
}

/** Feed real event tuples into the real interpolation buffer. */
function buffer(...entries) {
  const b = new SnapshotBuffer();
  for (const [ev, t] of entries) b.pushEvents([ev], 0, t);
  return b;
}

const ATK = (src, dst, kind = 'none') => ['atk', src, dst, kind];
const multiOf = (list, id) => list.filter((g) => g.ev[1] === id).map((g) => g.multi);

describe('one attack = one group (render/facing.js attackGroups)', () => {
  test('a fast single-target attacker is NOT an area attacker: three attacks in the window are three groups', () => {
    const b = buffer([ATK(1, 9), 0.1], [ATK(1, 9), 0.4], [ATK(1, 9), 0.7]);
    assert.deepEqual(multiOf(attackGroups(b, 0, 1.5), 1), [false, false, false], '0.3 s apart = separate attacks');
  });

  test('a 群攻 attack is ONE group with several distinct targets — including its first target', () => {
    const b = buffer([ATK(2, 9), 0.2], [ATK(2, 10), 0.2], [ATK(2, 11), 0.2]);
    const groups = attackGroups(b, 0, 1.5).filter((g) => g.ev[1] === 2);
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.map((g) => g.multi), [true, true, true], 'every event of the area attack is marked');
  });

  test('two hits on the SAME target in one tick are a single-target attack (a 连击), not 群攻', () => {
    const b = buffer([ATK(3, 9), 0.2], [ATK(3, 9), 0.2]);
    assert.deepEqual(multiOf(attackGroups(b, 0, 1.5), 3), [false, false]);
  });

  test('a bounce is not this unit´s own attack, and other events ride along in order (the skill state)', () => {
    const b = buffer([ATK(4, 9, 'chain'), 0.2], [ATK(4, 10, 'chain'), 0.2], [['skill', 4, 1], 0.2]);
    const plan = attackGroups(b, 0, 1.5);
    assert.deepEqual(plan.map((p) => p.ev[0]), ['atk', 'atk', 'skill'], 'every queued event, in order');
    assert.deepEqual(plan.map((p) => p.group), [null, null, null], 'neither the bounces nor the skill join a group');
    assert.deepEqual(plan.map((p) => p.multi), [false, false, false]);
    assert.deepEqual(attackGroups(b, 0.5, 1.5), [], 'no window → no plan');
  });
});

describe('the turn happens when the animation starts, and only then', () => {
  test('a fast single-target attack turns the model at the wind-up; the turnaround takes FACING_TURN_S', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    const target = at(4, 12);                       // straight up: the Back model is wanted
    assert.equal(v.modelFlip(), 1, 'deployed facing: Front model, not mirrored');
    const started = v.windUp(0.4, 'none');
    assert.equal(started, true, 'the wind-up was accepted');
    assert.equal(v.faceTarget(target, false, { lead: 0.4 }), true);
    assert.equal(v.viewDir, 'UP');
    assert.equal(v._flipSwap, true, 'the skeleton swap is owed at the sweep midpoint (there is room before the strike)');
    run(v, FACING_TURN_S * 0.4);
    assert.equal(v.entryBack, false, 'still on the Front model: the swap waits for the midpoint');
    run(v, FACING_TURN_S * 0.2);
    assert.equal(v.entryBack, true, '换骨架: the Back model takes over at the midpoint');
    run(v, FACING_TURN_S);
    assert.equal(v._flipT, 1, 'the sweep settled');
    assert.equal(v.modelFlip(), 1, 'UP draws the Back model unmirrored');
  });

  test('a refused wind-up never turns the model', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    assert.equal(v.windUp(0.4, 'none'), true);
    // a second attack of the same clip while this one is still playing is refused by the actor
    assert.equal(v.windUp(0.4, 'none'), false);
    assert.equal(v.viewDir, null, 'no turn for an attack that never started');
  });

  test('群攻 never turns — not even for its first target', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.windUp(0.4, 'none');
    assert.equal(v.faceTarget(at(4, 12), true, { lead: 0.4 }), false, 'area attack: no turn');
    assert.equal(v.viewDir, null);
    // and the deferred onAttack path gets the same answer
    v.onAttack(at(4, 12), 0, 'none', true);
    assert.equal(v.viewDir, null, 'the first target of an area attack does not turn the model either');
  });

  test('a delayed batch turns BEFORE its clip starts, never during it', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    // what render/app.js windUpAttacks does: ask, turn (swap included), then start the clip
    assert.equal(v.canWindUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4, instant: true }), true);
    assert.equal(v.entryBack, true, '换骨架 already done: the new model starts the clip from its first frame');
    assert.equal(v._flipSwap, false, 'nothing left to swap later (that would replay a swing already playing)');
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.actor.current, 'Attack');
    // the deferred path (an attack with no look-ahead left) may not turn the model mid-swing
    const before = v.viewDir;
    v.onAttack(at(1, 9), 0, 'none', false);
    assert.equal(v.viewDir, before, 'onAttack never turns now: its clip starts at the strike frame');
  });

  test('the sweep is a FIXED 0.15 s of GAME time, whatever the lead', async () => {
    // the official turn animation is one fixed length; a short lead does not shorten it (and never cancels it)
    const { v } = await ally({ dir: 'RIGHT' });
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.05 }), true, 'a short lead still turns');
    assert.equal(v._flipDur, FACING_TURN_S, 'the sweep is not compressed to the lead');
    const { v: v2 } = await ally({ dir: 'RIGHT' });
    assert.equal(v2.faceTarget(at(4, 12), false, { lead: 0.4 }), true);
    assert.equal(v2._flipDur, FACING_TURN_S);
  });
});

describe('held facing, and going back to the deployed direction', () => {
  test('a stunned operator keeps its facing and does not turn', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.windUp(0.4, 'none');
    v.faceTarget(at(4, 12), false, { lead: 0.4 });
    assert.equal(v.viewDir, 'UP');
    v.onStatus('stun', true);
    assert.equal(v.faceTarget(at(10, 9), false, { lead: 0.4 }), false, 'no turn while stunned');
    run(v, 2);
    assert.equal(v.viewDir, 'UP', 'the stun clip plays in the facing the model had');
    v.onStatus('stun', false);
    v.actor.update(3);                       // the clip that was playing ends
    v.setHasTarget(false);                   // and the targeting frame finds nothing
    run(v, 0.05);
    assert.equal(v.viewDir, null, 'once it can act again and nothing attacks, it faces the deployed direction');
  });

  test('the model goes back after the attack animation ends (no fixed 3 s timer)', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.windUp(0.4, 'none');
    v.faceTarget(at(4, 12), false, { lead: 0.4 });
    run(v, 0.6);
    assert.equal(v.viewDir, 'UP', 'still in the attack clip / its recovery');
    // let the clip finish: the actor leaves attack mode, but the unit is still in the fight (a retarget may follow), so the
    // facing is kept until a real pause longer than one attack interval
    v.actor.update(3);
    v.setHasTarget(true);
    run(v, 0.05);
    assert.equal(v.viewDir, 'UP', 'still has a target: the facing is kept');
    v.setHasTarget(false);
    run(v, 0.05);
    assert.equal(v.viewDir, null, '回正 once the clip is over and nothing is in range');
    assert.equal(v.modelFlip(), 1);
    run(v, FACING_TURN_S);
    await tick(); await tick();              // the Front model loads asynchronously
    assert.equal(v.entryBack, false, 'and it is back on the Front model of the deployed RIGHT facing');
  });

  test('a new attack during the recovery keeps the facing (no flicker back and forth)', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.windUp(0.4, 'none');
    v.faceTarget(at(4, 12), false, { lead: 0.4 });
    run(v, FACING_TURN_S + 0.05);
    v.actor.update(3);                       // clip over
    v.windUp(0.4, 'none');                   // the next attack is already winding up
    run(v, 0.05);
    assert.equal(v.viewDir, 'UP', 'the next attack keeps it facing the target');
  });
});

describe('Front / Back model switch while a skill clip is on', () => {
  test('a skill does not drop the turned facing, and the turn still swaps Front ⇄ Back', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.setSkill(true);
    v.windUp(0.4, 'none');
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true);
    run(v, FACING_TURN_S + 0.02);
    assert.equal(v.entryBack, true, 'skill clip + turn: the Back skeleton still takes over');
    assert.equal(v.viewDir, 'UP', 'the skill clip does not reset the facing');
    v.setSkill(false);
    assert.equal(v.viewDir, 'UP', 'and turning the skill off does not reset it either');
    assert.equal(v.faceTarget(at(0, 9), false, { lead: 0.4 }), true, 'a new target turns it again');
    assert.equal(v.viewDir, 'LEFT');
  });
});

describe('enemies turn too (left / right only: no Back model)', () => {
  /** An enemy view (no deploy direction, Front model only). */
  async function enemyView(info = {}, assets = store()) {
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    const v = new UnitView(ctx, { id: 7, side: 'enemy', kind: 'enemy', defId: 'enemy_test', spine: 'enemy_test', tier: 1, x: 4, y: 9, maxHp: 1000, ...info });
    await tick(); await tick();
    // an enemy starts mirrored; make it walk right so the left turn below is a real change of facing
    if (!v.fixedFacing) { v.visFacing = 1; v._settleFlip(); }
    return { v, assets };
  }

  test('a target to its left mirrors it; a target straight above keeps the horizontal', async () => {
    const { v } = await enemyView();
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), true, 'left target');
    assert.equal(v.viewDir, 'LEFT');
    assert.equal(v.entryBack, false, 'an enemy has no Back model: nothing to swap');
    run(v, FACING_TURN_S + 0.02);
    assert.equal(v.modelFlip(), -1, 'drawn mirrored after the sweep');
    // straight above: nothing to turn (no vertical model)
    const { v: v2 } = await enemyView();
    assert.equal(v2.faceTarget(at(4, 14), false, { lead: 0.4 }), false, 'above / below keeps the horizontal');
  });

  test('a FIXED_FACING leader never turns', async () => {
    const { v } = await enemyView({ defId: 'enemy_9013_acstmk', spine: 'enemy_9013_acstmk' });
    assert.equal(v.fixedFacing, 1);
    assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), false, 'drawn one way only');
  });

  test('the velocity / attack-impulse facing does not fight the turn, and the clip end gives it back', async () => {
    const { v } = await enemyView();
    v.windUp(0.4, 'none');
    v.faceTarget(at(1, 9), false, { lead: 0.4 });
    v.onAttack(at(9, 9), 0, 'none', false);          // the enemy's own attack bookkeeping: must not flip it back
    assert.equal(v.viewDir, 'LEFT');
    assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), false, 'already facing it');
    v.actor.update(3);                               // the clip ends
    v.setHasTarget(true);
    run(v, 0.05);
    assert.equal(v.viewDir, null, 'an enemy has no targeting frame: the end of its clip ends the turn');
    run(v, 0.2);                                  // ... and it sweeps back (0.15 game s)
    assert.equal(v.modelFlip(), 1, 'back to the direction it walks in');
    v.setHasTarget(false);                           // the targeting frame found nothing
    run(v, 0.05);
    assert.equal(v.viewDir, null, 'back to the velocity rule');
  });
});
describe('a dead target is replaced first, then the model decides', () => {
  test('a new target in the SAME direction does not turn the model again (no left -> right -> left sweep)', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), true);   // a target to the left
    assert.equal(v.viewDir, 'LEFT');
    run(v, 0.2);
    v.actor.update(3);                                                  // that target dies mid-swing, the clip ends
    run(v, 0.05);
    v.setHasTarget(true);                                               // the targeting frame still sees a target
    run(v, 0.05);
    assert.equal(v.viewDir, 'LEFT', 'still has a target: no revert to the deployed RIGHT in the gap');
    // the next target is also to the left: the direction is already right, so no sweep at all
    v.windUp(0.4, 'none');
    assert.equal(v.faceTarget(at(1.5, 9), false, { lead: 0.4 }), false, 'same direction: nothing to turn');
    assert.equal(v.viewDir, 'LEFT');
    assert.equal(v._flipT, 1, 'and no transition was started');
  });

  test('a new target in another direction does turn it', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), true);
    run(v, 0.2);
    v.actor.update(3);
    run(v, 0.05);
    v.windUp(0.4, 'none');
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true, 'the new target is above');
    assert.equal(v.viewDir, 'UP');
  });

  test('a pause in the fight gives the deployed direction back', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), true);
    v.actor.update(3);
    v.setHasTarget(false);                              // the targeting frame found nothing
    run(v, 0.05);
    assert.equal(v.viewDir, null, '回正 once the clip is over and nothing is in range');
  });
});
describe('the turnaround runs on the animation clock', () => {
  test('at the renderer rate (~2 game-s per real s) the sweep takes ~0.075 real s', async () => {
    const ctx = fakeViewCtx(fake.P, { assets: store(), cam, animRate: () => 2 });
    const v = new UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId: 'char_x', spine: 'char_x', tier: 3, x: 4, y: 9, maxHp: 1000, dir: 'RIGHT' });
    await tick(); await tick();
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true);
    const camera = cam();
    let real = 0;
    for (let i = 0; i < 120 && v._flipT < 1; i++) { v.update(1 / 60, camera, 0); real += 1 / 60; }
    assert.equal(v._flipT, 1, 'the sweep finished');
    assert.ok(real > 0.05 && real < 0.12, `real seconds for one game-time turn: ${real.toFixed(3)}`);
  });
});

describe('the Back model has two sides', () => {
  test('a turn to UP keeps the deployed side: LEFT stays left', async () => {
    const { v } = await ally({ dir: 'LEFT' });
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true, 'straight above');
    assert.equal(v.viewDir, 'UP');
    run(v, 0.3);                                  // the skeleton swaps at the middle of the sweep
    assert.equal(v.entryBack, true, 'the Back model');
    assert.equal(v.modelFlip(), -1, 'and it faces LEFT: the back has two orientations');
  });

  test('a turn to UP from a RIGHT deployment faces right', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true);
    assert.equal(v.viewDir, 'UP');
    run(v, 0.3);
    assert.equal(v.entryBack, true);
    assert.equal(v.modelFlip(), 1);
  });

  test('an up target slightly on the left gets a left-facing back', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    // inside the up band but clearly on the left: normalized x = 0.5 / 1.118 = 0.45, past the dead zone
    assert.equal(v.faceTarget(at(3.5, 10), false, { lead: 0.4 }), true);
    assert.equal(v.viewDir, 'UP');
    run(v, 0.3);
    assert.equal(v.modelFlip(), -1, 'the back faces the side the target is on');
  });

  test('the revert returns to the deployed side', async () => {
    const { v } = await ally({ dir: 'LEFT' });
    v.faceTarget(at(7, 9), false, { lead: 0.4 });      // turn right, Front model
    run(v, 0.3);
    assert.equal(v.modelFlip(), 1);
    v.clearFacing();
    run(v, 0.3);
    assert.equal(v.modelFlip(), -1, 'back to the deployed LEFT side');
    assert.equal(v.entryBack, false, 'and the Front model');
  });
});

describe('the transition is smooth and the back faces the target side', () => {
  test('the squeeze eases at both ends and bulges while edge-on', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.faceTarget(at(4, 12), false, { lead: 0.4 });
    const camera = cam();
    const squash = [];
    let bulgeMax = 0;
    for (let i = 0; i < 40; i++) {
      v.update(1 / 60, camera, 0);
      if (v._flipT >= 1) break;                       // the settling frame is not part of the sweep
      squash.push(v._flipSquash);
      bulgeMax = Math.max(bulgeMax, v._flipBulge);
    }
    assert.ok(squash.length >= 6, `frames in the sweep: ${squash.length}`);
    assert.ok(squash[0] > 0.9, `eased in: ${squash[0].toFixed(2)}`);
    assert.ok(Math.min(...squash) < 0.2, `edge-on somewhere in the sweep: ${Math.min(...squash).toFixed(2)}`);
    assert.ok(squash[squash.length - 1] > 0.9, `eased out: ${squash[squash.length - 1].toFixed(2)}`);
    assert.ok(bulgeMax > 1.05, `height bulge: ${bulgeMax.toFixed(2)}`);
  });

  test('the dead zone keeps the sign close to vertical, and the target decides outside it', async () => {
    // 0.02 tiles left at 3 tiles up: normalized |x| = 0.0067, inside TOLERANCE (0.2) -> the deployed sign survives
    const near = await ally({ dir: 'RIGHT' });
    assert.equal(near.v.faceTarget(at(3.98, 12), false, { lead: 0.4 }), true);
    assert.equal(near.v.viewDir, 'UP');
    run(near.v, 0.3);
    assert.equal(near.v.entryBack, true);
    assert.equal(near.v.modelFlip(), 1, 'inside the dead zone the previous sign is kept');

    // 0.5 tiles left at 1 tile up: normalized |x| = 0.45, outside it -> the target side wins
    const far = await ally({ dir: 'RIGHT' });
    assert.equal(far.v.faceTarget(at(3.5, 10), false, { lead: 0.4 }), true);
    assert.equal(far.v.viewDir, 'UP');
    run(far.v, 0.3);
    assert.equal(far.v.modelFlip(), -1, 'outside the dead zone the target decides the side');
  });

  test('an exact tie keeps the side the model already had', async () => {
    const { v } = await ally({ dir: 'LEFT' });
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true);   // straight above
    run(v, 0.3);
    assert.equal(v.modelFlip(), -1, 'the deployed LEFT side');
  });
});

describe('a horizontal turn keeps the skeleton', () => {
  test('deployed UP: a target to the side stays on the Back model', async () => {
    const { v } = await ally({ dir: 'UP' });
    run(v, 0.2);
    assert.equal(v.entryBack, true, 'deployed facing up: the Back model');
    assert.equal(v.faceTarget(at(1, 9.5), false, { lead: 0.4 }), true, 'a target to the left');
    run(v, 0.3);
    assert.equal(v.viewDir, 'LEFT');
    assert.equal(v.entryBack, true, 'still the Back model: the official client only mirrors for a horizontal turn');
    assert.equal(v.modelFlip(), -1, 'mirrored to face left');
    v.clearFacing();
    run(v, 0.3);
    assert.equal(v.entryBack, true, 'the revert restores the deployed Back model too');
    assert.equal(v.modelFlip(), 1);
  });

  test('deployed UP: a target BELOW does take the Front model, and the revert returns to Back', async () => {
    const { v } = await ally({ dir: 'UP' });
    assert.equal(v.faceTarget(at(4, 6), false, { lead: 0.4 }), true);
    run(v, 0.3);
    assert.equal(v.viewDir, 'DOWN');
    assert.equal(v.entryBack, false, 'a vertical direction does change the skeleton');
    v.clearFacing();
    run(v, 0.3);
    assert.equal(v.entryBack, true, 'and the revert brings the deployed Back model back');
  });

  test('deployed RIGHT: a horizontal turn stays on the Front model', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    assert.equal(v.faceTarget(at(1, 9.5), false, { lead: 0.4 }), true);
    run(v, 0.3);
    assert.equal(v.entryBack, false);
    assert.equal(v.modelFlip(), -1);
    // ... and a target above does take the Back model
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true);
    run(v, 0.3);
    assert.equal(v.entryBack, true, 'UP uses the Back model');
    // ... and then a target to the side keeps it
    assert.equal(v.faceTarget(at(7, 9.5), false, { lead: 0.4 }), true);
    run(v, 0.3);
    assert.equal(v.entryBack, true, 'strafing from the Back model keeps it');
  });
});

describe('the stickiness is battle-only', () => {
  test('a settled model always shows the deployment\'s own skeleton', async () => {
    // battle: deploy RIGHT, a target above takes the Back model, then a side target keeps it (sticky)
    const { v } = await ally({ dir: 'RIGHT' });
    v.faceTarget(at(4, 12), false, { lead: 0.4 });
    run(v, 0.3);
    assert.equal(v.entryBack, true);
    v.faceTarget(at(7, 9), false, { lead: 0.4 });
    run(v, 0.3);
    assert.equal(v.entryBack, true, 'battle: the side target keeps the Back model');

    // the turn ends: a settled model goes back to what its deployment asks for (RIGHT -> Front)
    v.clearFacing();
    run(v, 0.3);
    assert.equal(v.entryBack, false, 'settled: the deployment owns the skeleton again');
    assert.equal(v.modelFlip(), 1);
  });

  test('a redeploy with another direction settles on that direction\'s skeleton', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.faceTarget(at(4, 12), false, { lead: 0.4 });   // Back model
    run(v, 0.3);
    assert.equal(v.entryBack, true);
    v.setDir('LEFT');                                 // the sim re-orients the unit (a redeploy)
    run(v, 0.3);
    assert.equal(v.viewDir, null);
    assert.equal(v.entryBack, false, 'LEFT is a Front direction');
    assert.equal(v.modelFlip(), -1);
  });
});

describe('a turn -> revert cycle repeats', () => {
  test('the SECOND turn still reverts (the deployed sign is restored every time)', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.setHasTarget(true);

    // turn 1: to the left, Front model
    assert.equal(v.faceTarget(at(1, 9.5), false, { lead: 0.4 }), true);
    run(v, 0.3);
    assert.equal(v.viewDir, 'LEFT');
    assert.equal(v.modelFlip(), -1);
    v.clearFacing();
    run(v, 0.3);
    assert.equal(v.viewDir, null, 'revert 1');
    assert.equal(v.modelFlip(), 1, 'back to the deployed RIGHT side');
    assert.equal(v.faceSign, 1, 'the deployed sign is restored, not left at the target side');

    // turn 2: straight up (Back model) - the dead zone must carry the DEPLOYED sign, so it faces right
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true);
    run(v, 0.3);
    assert.equal(v.viewDir, 'UP');
    assert.equal(v.entryBack, true);
    assert.equal(v.modelFlip(), 1, 'the back faces the deployed side');
    v.clearFacing();
    run(v, 0.3);
    assert.equal(v.viewDir, null, 'revert 2 still happens');
    assert.equal(v.entryBack, false, 'and the Front model is back');
    assert.equal(v.modelFlip(), 1);

    // turn 3: left again, then revert again
    assert.equal(v.faceTarget(at(1, 9.5), false, { lead: 0.4 }), true);
    run(v, 0.3);
    assert.equal(v.modelFlip(), -1);
    v.clearFacing();
    run(v, 0.3);
    assert.equal(v.viewDir, null, 'revert 3');
    assert.equal(v.modelFlip(), 1);
  });
});

describe('an enemy goes back to its walking direction', () => {
  /** An enemy view whose attack clip can be ended, plus a way to feed its velocity. */
  async function enemy(info = {}) {
    const assets = store();
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    const v = new UnitView(ctx, { id: 7, side: 'enemy', kind: 'enemy', defId: 'enemy_test', spine: 'enemy_test', tier: 1, x: 4, y: 9, maxHp: 1000, ...info });
    await tick(); await tick();
    v.visFacing = 1; v._settleFlip();            // walking right
    return v;
  }

  test('after the attack clip ends it faces the way it moves again', async () => {
    const v = await enemy();
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), true, 'turned toward the target on its left');
    assert.equal(v.viewDir, 'LEFT');
    v.actor.update(3);                            // the clip is over
    run(v, 0.05);
    assert.equal(v.viewDir, null, 'no targeting frame for enemies: the end of the clip is what ends the turn');
    run(v, 0.2);                                  // the revert is a swept turn too (0.15 game s)
    assert.equal(v.modelFlip(), 1, 'walking direction (right) again');
  });

  test('walking on drops the turn at once, even before the clip would end', async () => {
    const v = await enemy();
    v.windUp(0.4, 'none');
    v.faceTarget(at(1, 9), false, { lead: 0.4 });
    assert.equal(v.viewDir, 'LEFT');
    v.actor.update(3);                            // clip over
    v.sync({ x: 4, y: 9, vx: 1.5, vy: 0 });       // it starts walking right
    assert.equal(v.viewDir, null, 'movement wins');
    assert.equal(v.modelFlip(), 1);
  });

  test('a moving enemy that has NOT attacked keeps the velocity rule', async () => {
    const v = await enemy();
    v.sync({ x: 4, y: 9, vx: -1.5, vy: 0 });
    assert.equal(v.viewDir, null);
    assert.equal(v.modelFlip(), -1, 'walking left -> mirrored');
  });
});
describe('the swap continues the attack, and short / late leads still turn', () => {
  test('a short lead still turns (fixed 0.15 game s sweep)', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.05 }), true, 'a short lead is still a turn');
    assert.equal(v._flipDur, FACING_TURN_S);
    assert.equal(v.viewDir, 'UP');
  });

  test('a late event (lead 0) still turns, overlapping the clip', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.onAttack(at(4, 12), 1, 'none', false);      // the strike already happened: the event is late
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0 }), true, 'a late attack turns too');
    assert.equal(v._flipDur, 0.15, 'the turn is never shortened: it runs with the clip');
    assert.equal(v.viewDir, 'UP');
    run(v, 0.3);
    assert.equal(v._flipT, 1, 'and it settles');
    assert.equal(v.entryBack, true, 'on the Back model, as the direction asks');
  });

  test('the Front / Back swap resumes the wind-up on the new model', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4, instant: true }), true, 'turn + swap before the clip');
    await tick(); await tick();                   // the new model arrives
    assert.equal(v.entryBack, true);
    assert.ok(v.actor, 'the new model is in place');
    assert.equal(v.actor.current, v.actor._attackClip()?.loop, 'and it is playing the attack clip, not idling');
    assert.ok(v.actor.mode === 'attack' || v.actor.clock < v.actor.attackUntil, 'the attack continues');
  });

  test('a swap after the strike replays the clip from its strike frame', async () => {
    const { v } = await ally({ dir: 'RIGHT' });
    v.onAttack(at(4, 12), 1, 'none', false);      // the strike happened on the old model
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0, instant: true }), true);
    await tick(); await tick();
    assert.equal(v.entryBack, true);
    assert.equal(v.actor.current, v.actor._attackClip()?.loop, 'the swing continues on the new model');
  });
});