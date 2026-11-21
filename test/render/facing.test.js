// render/facing.js — the operator model facing (DESIGN §37.329; PR #730 by @Seals-awa, ported to the rules the maintainer
// fixed on 2026-10-21 / 10-23): the official four-direction resolution, the facing state machine (turn when an attack
// starts, hold until the next one — no turn back on its own), the 0.15 s turn with the skeleton change in its middle,
// the area-attack marking of a batch and the face-mode table lookup. Pure: no PIXI, no assets.
//
//   node --test test/render/facing.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FACING_TURN_S, FACE_SIGN_LEFT, FACE_SIGN_RIGHT, parseDirection, facingDir, FacingState, markAreaAttacks,
  faceModeFlags, faceAction, faceModeFor, FACE_CONFLICT_ROW,
} from '../../public/js/render/facing.js';

/** Run a state's turn to its end in 60 fps steps; returns how many steps reported the skeleton change. */
function settle(f, s = 0.5) {
  let swaps = 0;
  for (let t = 0; t < s; t += 1 / 60) if (f.step(1 / 60)) swaps++;
  return swaps;
}

describe('the official four-direction resolution', () => {
  test('ParseDirection: 0 up / 1 right / 2 down / 3 left, the addon on the horizontal entries only, ties to the earlier', () => {
    assert.equal(parseDirection(0, 1), 0);
    assert.equal(parseDirection(1, 0), 1);
    assert.equal(parseDirection(0, -1), 2);
    assert.equal(parseDirection(-1, 0), 3);
    // (1, 1.2): up 0.768 against right 0.640 — the 0.25 addon makes it right
    assert.equal(parseDirection(1, 1.2, 0), 0);
    assert.equal(parseDirection(1, 1.2, 0.25), 1);
    assert.equal(parseDirection(1, 1), 0, 'a diagonal tie keeps the earlier index (strict >)');
    assert.equal(parseDirection(0, 0), 0, 'no offset: the default direction');
  });

  test('facingDir: too close or no offset judges nothing; the dead zone keeps the sign; past ±0.2 the side decides', () => {
    assert.deepEqual(facingDir(0.1, 0.1, FACE_SIGN_RIGHT), { dir: null, sign: FACE_SIGN_RIGHT }, 'within 0.25 tile');
    assert.deepEqual(facingDir(0.005, 0.005, FACE_SIGN_LEFT), { dir: null, sign: FACE_SIGN_LEFT });
    // straight above (|dx| ≤ 0.2 tile): UP, mirror carried over from either side
    assert.deepEqual(facingDir(0.15, 2, FACE_SIGN_RIGHT), { dir: 'UP', sign: FACE_SIGN_RIGHT });
    assert.deepEqual(facingDir(0.15, 2, FACE_SIGN_LEFT), { dir: 'UP', sign: FACE_SIGN_LEFT });
    assert.deepEqual(facingDir(-0.2, 3, FACE_SIGN_RIGHT), { dir: 'UP', sign: FACE_SIGN_RIGHT }, 'the band\'s edge keeps it');
    // above but off to one side (|x| > 0.2): still UP, the mirror by the side
    assert.deepEqual(facingDir(-0.6, 2, FACE_SIGN_RIGHT), { dir: 'UP', sign: FACE_SIGN_LEFT });
    assert.deepEqual(facingDir(0.6, 2, FACE_SIGN_LEFT), { dir: 'UP', sign: FACE_SIGN_RIGHT });
    assert.deepEqual(facingDir(-3, -1, FACE_SIGN_RIGHT), { dir: 'LEFT', sign: FACE_SIGN_LEFT });
    assert.deepEqual(facingDir(0, -2, FACE_SIGN_LEFT), { dir: 'DOWN', sign: FACE_SIGN_LEFT });
  });

  test('the dead zone is on the raw x offset in tiles, not the normalized one [ASSUMED reading of research 10 §3]', () => {
    // _CalculateLOrRDirection compares the v.x it is given with ±0.2 (only ParseDirection normalizes, its own copy);
    // the caller's TOO_CLOSE check on |v|² says that v is the raw offset. Normalized, all three would keep the old side.
    assert.deepEqual(facingDir(0.5, 2.5, FACE_SIGN_LEFT), { dir: 'UP', sign: FACE_SIGN_RIGHT }, '0.5 / 2.55 = 0.196 normalized');
    assert.deepEqual(facingDir(0.4, 3, FACE_SIGN_LEFT), { dir: 'UP', sign: FACE_SIGN_RIGHT });
    assert.deepEqual(facingDir(-0.35, 2, FACE_SIGN_RIGHT), { dir: 'UP', sign: FACE_SIGN_LEFT });
    assert.deepEqual(facingDir(-1, -6, FACE_SIGN_RIGHT), { dir: 'DOWN', sign: FACE_SIGN_LEFT }, 'a long-range target one column over');
  });
});

describe('the facing state machine', () => {
  test('it starts on the deployment: LEFT is mirrored, UP shows the Back skeleton', () => {
    const l = new FacingState('LEFT');
    assert.equal(l.sign, FACE_SIGN_LEFT);
    assert.equal(l.drawSign(), -1);
    assert.equal(l.back, false);
    const u = new FacingState('UP');
    assert.equal(u.shownBack, true);
    assert.equal(u.drawSign(), 1);
    assert.equal(new FacingState(null).deployDir, 'RIGHT', 'junk: RIGHT, as the sim defaults');
  });

  test('a new attack on another target turns again; the same direction again is no turn', () => {
    const f = new FacingState('RIGHT');
    assert.equal(f.turn(-3, 0), true, 'a target to the left');
    assert.equal(f.turning, true);
    assert.equal(f.drawSign(), 1, 'the turn starts from the old mirror');
    settle(f);
    assert.equal(f.drawSign(), -1);
    assert.equal(f.view, 'LEFT');
    assert.equal(f.turn(-2, 0.5), false, 'another target on the same side: nothing to draw');
    assert.equal(f.turn(4, 0), true, 'the next attack goes right again');
    settle(f);
    assert.equal(f.drawSign(), 1);
  });

  test('nothing turns it back: no step of time does (the end of the action, a dead target, a long idle)', () => {
    const f = new FacingState('RIGHT');
    f.turn(-3, 0);
    settle(f);
    // ten game seconds of frames, no attack: the facing holds ([ASSUMED] for the long idle the recordings do not show)
    for (let i = 0; i < 600; i++) assert.equal(f.step(1 / 60), false);
    assert.equal(f.drawSign(), -1);
    assert.equal(f.view, 'LEFT');
    assert.equal(f.turning, false);
  });

  test('the turn lasts FaceSwitcher._switchTime (0.15 game s) and flips the mirror where it is edge-on', () => {
    assert.equal(FACING_TURN_S, 0.15);
    const f = new FacingState('RIGHT');
    f.turn(-3, 0);
    f.step(0.07);
    assert.equal(f.drawSign(), 1, 'before the middle');
    assert.ok(f.drawScale() < 0.25, `nearly edge-on at 0.07 s (${f.drawScale()})`);
    f.step(0.01);
    assert.equal(f.drawSign(), -1, 'past the middle');
    f.step(0.07 - 1e-9);
    assert.equal(f.turning, true, 'not yet 0.15 s');
    f.step(1e-6);
    assert.equal(f.turning, false);
    assert.equal(f.drawScale(), 1);
  });

  test('a target above changes to the Back skeleton once, in the middle of the turn, squeezed edge-on', () => {
    const f = new FacingState('RIGHT');
    assert.equal(f.turn(0.6, 2), true, 'up and to the right: same mirror, other skeleton');
    assert.equal(f.back, true);
    assert.equal(f.shownBack, false, 'still the Front model at the start');
    f.step(0.06);
    assert.equal(f.shownBack, false);
    assert.equal(f.drawSign(), 1, 'the mirror stays');
    assert.ok(f.drawScale() < 0.5, 'squeezed');
    assert.equal(f.step(0.02), true, 'the swap is due at the middle');
    assert.equal(f.shownBack, true);
    assert.equal(settle(f), 0, 'and only once');
    assert.equal(f.drawScale(), 1);
  });

  test('both targets UP but on either side of the dead zone: the mirror alone changes, and that is a turn', () => {
    const f = new FacingState('RIGHT');
    f.turn(0.6, 2);
    settle(f);
    assert.equal(f.turn(-0.6, 2), true, 'up-left after up-right (the review of 2026-10-21)');
    assert.equal(f.view, 'UP');
    assert.equal(settle(f), 0, 'no skeleton change');
    assert.equal(f.drawSign(), -1);
    assert.equal(f.turn(0.1, 2), false, 'straight above: the dead zone keeps the left mirror');
  });

  test('a horizontal target keeps the skeleton (mirror only); a target below asks for the Front one', () => {
    const f = new FacingState('UP');
    assert.equal(f.turn(3, 0), false, 'deployed UP, target to the right: Back model facing right already');
    assert.equal(f.turn(-3, 0), true);
    assert.equal(settle(f), 0, 'mirror only');
    assert.equal(f.shownBack, true);
    assert.equal(f.turn(0, -2), true, 'below');
    assert.equal(settle(f), 1);
    assert.equal(f.shownBack, false);
    assert.equal(f.turn(3, 0), true, 'right again: the Front model it has now, mirrored back');
    assert.equal(settle(f), 0);
    assert.equal(f.shownBack, false);
  });

  test('Front mode and a model without a Back skeleton turn by the mirror only', () => {
    const front = new FacingState('RIGHT');
    assert.equal(front.turn(-0.6, 2, { front: true }), true);
    assert.equal(front.back, false);
    assert.equal(settle(front), 0);
    const flat = new FacingState('RIGHT');
    assert.equal(flat.turn(0.6, 2, { canBack: false }), false, 'same mirror, no skeleton to change: no turn');
    assert.equal(flat.turning, false);
  });

  test('toDeploy (Default mode) goes back to the deployed mirror and skeleton; reset settles at once', () => {
    const f = new FacingState('UP');
    f.turn(-0.5, -2);
    settle(f);
    assert.equal(f.shownBack, false);
    assert.equal(f.toDeploy(), true);
    assert.equal(settle(f), 1);
    assert.equal(f.shownBack, true);
    assert.equal(f.drawSign(), 1);
    assert.equal(f.view, null);
    assert.equal(f.toDeploy(), false, 'already there');
    f.turn(-3, 0);
    f.reset('LEFT');
    assert.equal(f.turning, false);
    assert.equal(f.drawSign(), -1);
    assert.equal(f.shownBack, false);
  });
});

describe('area attacks of a batch', () => {
  test('a source with more than one distinct target in the batch is an area attack; repeats and bounces are not', () => {
    const a1 = ['atk', 1, 10, 'none'], a2 = ['atk', 1, 11, 'none'];
    const s1 = ['atk', 2, 10, 'arrow'], s2 = ['atk', 2, 10, 'arrow'];
    const c1 = ['atk', 3, 12, 'chain'], c2 = ['atk', 3, 13, 'chain'];
    const out = new WeakSet();
    const n = markAreaAttacks([a1, ['dmg', 10, 5], a2, s1, s2, c1, c2, ['skill', 1, 1]], out);
    assert.equal(n, 2);
    assert.ok(out.has(a1) && out.has(a2), 'two targets of one source (the dmg in between does not split it)');
    assert.ok(!out.has(s1) && !out.has(s2), 'two hits on one target stay single-target');
    assert.ok(!out.has(c1) && !out.has(c2), 'chain bounces are not attacks of their source');
    assert.equal(markAreaAttacks(null, out), 0);
  });
});

describe('face modes', () => {
  test('flags and what they do at an attack start', () => {
    assert.equal(faceAction(faceModeFlags(undefined)), 'target', 'no row: Target');
    assert.equal(faceAction(faceModeFlags('none')), 'none');
    assert.equal(faceAction(faceModeFlags('Default')), 'deploy');
    assert.equal(faceAction(faceModeFlags('Default+ForceToDirection')), 'deploy', 'the direction clip is not played');
    assert.equal(faceAction(faceModeFlags('Target+ForceToDirection')), 'target');
    assert.equal(faceAction(faceModeFlags('Default+FirstCastTarget')), 'deploy');
    assert.equal(faceAction(faceModeFlags('Target+Default')), 'target');
    assert.ok(faceModeFlags('FirstCastTarget+CheckDownAttack').firstCast);
    assert.ok(faceModeFlags('Front').front);
  });

  test('faceModeFor: exact names first, the running kind, first cast vs later, then a prefix, then the default row', () => {
    const rows = [
      ['Attack', 'Target', '', '', 0, 'attack'],
      ['Skill_3_Attack', 'FirstCastTarget+CheckDownAttack', '', '', 0, 'skill'],
      ['Skill_3_Attack', 'Target', '', '', 0, 'skill'],
      ['Skill_2', 'Default', '', '', 0, 'skill'],
      ['', 'none', '', '', 0, 'unspecified'],
    ];
    assert.equal(faceModeFor(rows, ['Skill_3_Attack'], 'skill', { firstCast: true })[1], 'FirstCastTarget+CheckDownAttack');
    assert.equal(faceModeFor(rows, ['Skill_3_Attack'], 'skill', { firstCast: false })[1], 'Target');
    assert.equal(faceModeFor(rows, ['Skill_2_Loop'], 'skill')[1], 'Default', 'Skill_2 covers Skill_2_Loop');
    assert.equal(faceModeFor(rows, ['Combat'], 'attack')[1], 'none', 'no match: the default row');
    assert.equal(faceModeFor(rows, ['attack'], 'attack')[1], 'Target', 'case-insensitive');
    assert.equal(faceModeFor(null, ['Attack']), null);
  });

  test('faceModeFor: rows that disagree on what the model does resolve to Target, whatever their order [ASSUMED]', () => {
    const none = ['', 'none', '', '', 0, 'unspecified'], target = ['', 'Target', '', '', 0, 'unspecified'];
    const def = ['', 'Default', '', '', 0, 'unspecified'];
    const act = (rows, cands, kind, opts) => faceAction(faceModeFlags(faceModeFor(rows, cands, kind, opts)?.[1]));
    assert.equal(act([none, target], ['Attack'], 'attack'), 'target', 'default rows none / Target');
    assert.equal(act([target, none], ['Attack'], 'attack'), 'target', 'the same rows the other way round');
    assert.equal(faceModeFor([none, def], ['Attack'], 'attack'), FACE_CONFLICT_ROW, 'none / Default: no Target row to take');
    assert.equal(act([none, none], ['Attack'], 'attack'), 'none', 'rows that agree keep their mode');
    const a = (mode) => ['Attack', mode, '', '', 0, 'attack'];
    assert.equal(act([a('Default'), a('Target')], ['Attack'], 'attack'), 'target', 'same name, same kind');
    assert.equal(act([a('Target'), a('Default')], ['Attack'], 'attack'), 'target');
    assert.equal(act([a('Target'), a('Target+ForceToDirection')], ['Attack'], 'attack'), 'target', 'no conflict: both turn');
    // the kind and the first cast still choose before a conflict is looked for
    const k = [['Attack', 'Default', '', '', 0, 'skill'], a('Target')];
    assert.equal(act(k, ['Attack'], 'skill'), 'deploy', 'the running kind\'s row');
    const fc = [['Attack', 'FirstCastTarget', '', '', 0, 'skill'], ['Attack', 'Default', '', '', 0, 'skill']];
    assert.equal(act(fc, ['Attack'], 'skill', { firstCast: false }), 'deploy', 'the later attacks\' row');
    assert.ok(faceModeFlags(faceModeFor(fc, ['Attack'], 'skill', { firstCast: true })[1]).firstCast);
  });
});
