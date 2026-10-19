// The per-ability face-mode table (the owner's 10-face-modes.json → render/faceModes.js) and the behaviour it drives.
//
// Every operator's facing is not one rule: the official client stores, per ability animation, how the model is driven
// while that animation plays — Target (turn toward the target), none / Default (leave the facing alone), Front (never the
// Back model), ForceToDirection / CheckDownAttack (play the direction-specific clip: Attack_Down, Skill_1_Loop_Down, …),
// FirstCastTarget (keep the first cast's target) — plus escapeTime, how long the facing is kept after the clip.
// `node --test test/render/faceModes.test.js`
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { FACE_MODES } from '../../public/js/render/faceModes.js';
import { faceModeFlags, faceModeRow } from '../../public/js/render/facing.js';

let fake, UnitView, facingMod;
const mods = () => facingMod;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
  facingMod = await import('../../public/js/render/facing.js');
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('prep', { width: 1280, height: 720 });
const MODES = new Set([
  'Target', 'none', 'Default', 'Front', 'Default+ForceToDirection', 'Target+ForceToDirection', 'FirstCastTarget',
  'Default+FirstCastTarget', 'FirstCastTarget+CheckDownAttack', 'Target+Default',
]);

describe('the generated table', () => {
  test('covers every operator row of 10-face-modes.json and every row is well formed', () => {
    const ids = Object.keys(FACE_MODES);
    assert.equal(ids.length, 462, 'operators');
    let rows = 0;
    for (const id of ids) {
      const list = FACE_MODES[id];
      assert.ok(Array.isArray(list) && list.length > 0, `${id} has rows`);
      for (const row of list) {
        assert.equal(row.length, 6, `${id}: [animKey, mode, up, down, escapeTime, kind]`);
        assert.equal(typeof row[0], 'string');
        assert.equal(typeof row[1], 'string');
        assert.ok(MODES.has(row[1]), `${id}: unknown mode ${row[1]}`);
        assert.ok(['attack', 'skill', 'other', 'unspecified'].includes(row[5]), `${id}: kind`);
        assert.equal(typeof row[2], 'string');
        assert.equal(typeof row[3], 'string');
        assert.ok(row[4] >= 0 && row[4] < 10, `${id}: escapeTime`);
        rows++;
      }
    }
    assert.equal(rows, 1473, 'rows');
  });

  test('the direction-specific clips are named per direction (about 180 rows)', () => {
    const withUp = [];
    const withDown = [];
    let directionClips = 0;
    for (const [id, list] of Object.entries(FACE_MODES)) {
      for (const row of list) {
        if (row[2]) withUp.push([id, ...row]);
        if (row[3]) withDown.push([id, ...row]);
        const clip = row[2] || row[3];
        if (clip && /(Up|Down)/.test(clip)) directionClips++;
      }
    }
    assert.equal(withDown.length, 178, 'rows naming a down clip');
    assert.equal(withUp.length, 22, 'rows naming an up clip');
    // almost every one is that animation's _Up / _Down variant (a handful name an end clip instead: the table is the
    // source of truth, so this pins the shape rather than every value)
    assert.ok(directionClips >= 170, `named like _Up / _Down: ${directionClips}/${withDown.length + withUp.length}`);
  });
});

describe('faceModeFlags', () => {
  test('every mode string of the table maps to flags, and a `+` splits them', () => {
    assert.deepEqual(faceModeFlags('Target'), { target: true, none: false, def: false, front: false, forceDir: false, firstCast: false, checkDown: false });
    assert.deepEqual(faceModeFlags('none'), { target: false, none: true, def: false, front: false, forceDir: false, firstCast: false, checkDown: false });
    assert.deepEqual(faceModeFlags('Default'), { target: false, none: false, def: true, front: false, forceDir: false, firstCast: false, checkDown: false });
    assert.deepEqual(faceModeFlags('Front'), { target: false, none: false, def: false, front: true, forceDir: false, firstCast: false, checkDown: false });
    const fd = faceModeFlags('Default+ForceToDirection');
    assert.ok(fd.def && fd.forceDir && !fd.target, 'a default facing that still plays a direction clip');
    const cd = faceModeFlags('FirstCastTarget+CheckDownAttack');
    assert.ok(cd.firstCast && cd.checkDown && !fd.none);
    const td = faceModeFlags('Target+Default');
    assert.ok(td.target && td.def);
    assert.equal(faceModeFlags(undefined).target, true, 'no row: the default is Target');
  });
});

describe('faceModeRow', () => {
  test('an exact animKey match wins, then the ability default row, else nothing', () => {
    const chen2 = FACE_MODES.char_1013_chen2;
    assert.equal(faceModeRow(chen2, 'Attack')[0], 'Attack');
    assert.equal(faceModeRow(chen2, 'Attack')[3], 'Attack_Down', 'chen2 forces the down clip');
    assert.deepEqual(faceModeRow(chen2, 'Skill_9_Nope'), ['', 'Default+ForceToDirection', '', '', 0, 'unspecified'], 'falls back to the default row');
    assert.equal(faceModeRow(null, 'Attack'), null);
    assert.equal(faceModeRow(undefined, 'Attack'), null);
    assert.equal(faceModeRow([], 'Attack'), null);
    // an operator with only default rows resolves to the first one
    assert.equal(faceModeRow(FACE_MODES.char_002_amiya, 'Attack')[4], 0.133);
  });
});

/** A view whose skeleton has the clips the table names, and whose defId is a real operator. */
function store() {
  const anims = ['Idle', 'Attack', 'Attack_Down', 'Skill', 'Skill_Down', 'Start'];
  const entry = {
    skel: '/s/front.skel', atlas: '/s/front.atlas',
    anims: { idle: 'Idle', attack: { loop: 'Attack' }, skill: { loop: 'Skill' }, deploy: 'Start' },
    animations: Object.fromEntries(anims.map((n) => [n, 1])), hits: { Attack: [0.4] },
  };
  const back = { ...entry, skel: '/s/back.skel', atlas: '/s/back.atlas' };
  return {
    picture: () => null,
    image: async () => null,
    hasBack: () => true,
    spineEntry: (id, o) => (o && o.back ? back : entry),
    spine: { acquire: async () => ({ animations: anims.map((name) => ({ name })) }), release: () => {} },
  };
}

async function view(defId, info = {}) {
  const ctx = fakeViewCtx(fake.P, { assets: store(), cam });
  const v = new UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId, spine: defId, tier: 3, x: 4, y: 9, maxHp: 1000, dir: 'RIGHT', ...info });
  await tick(); await tick();
  return v;
}

const at = (x, y) => ({ x, y });
function run(v, seconds, dt = 1 / 60) {
  const camera = cam();
  for (let t = 0; t < seconds - 1e-9; t += dt) v.update(dt, camera, 0);
}

describe('the table drives the model', () => {
  test('an Attack row of `none` never turns (char_009_12fce)', async () => {
    const v = await view('char_009_12fce');
    assert.equal(v.faceRows?.[0]?.[1], 'none');
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), false, 'none: the facing stays');
    assert.equal(v.viewDir, null);
  });

  test('ForceToDirection plays the down clip instead of turning (char_1013_chen2, Attack → Attack_Down)', async () => {
    const v = await view('char_1013_chen2');
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(4, 4), false, { lead: 0.4 }), true, 'the down clip is played');
    assert.equal(v.actor.current, 'Attack_Down', 'the skeleton draws the direction itself');
    assert.equal(v.viewDir, null, 'no mirror turn: the clip carries the direction');
  });

  test('an up target keeps the Front model for a `Front` row (char_148_nearl, Skill)', async () => {
    const v = await view('char_148_nearl');
    v.setSkill(true);                                    // the skill clip (Skill) is the Front row
    await tick(); await tick();
    assert.equal(v.actor?.current, 'Skill');
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true);
    assert.equal(v.viewDir, 'UP');
    run(v, 0.2);
    assert.equal(v.entryBack, false, 'Front: the Back model is never loaded, even facing up');
  });

  test('the revert is animation + event driven: no per-operator delay is used', async () => {
    // char_002_amiya's rows carry escapeTime 0.133, but the table's delay is NOT read any more: the attack clip's own
    // length decides when it is over and the sim's targeting frame decides whether anything is left to face.
    const v = await view('char_002_amiya');
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(4, 12), false, { lead: 0.4 }), true);
    assert.equal(v.viewDir, 'UP');
    run(v, 0.05);
    assert.equal(v.viewDir, 'UP', 'the clip is still playing: the facing is kept by the animation, not by a timer');
    v.actor.update(3);                               // the clip is over
    v.setHasTarget(true);                            // and the targeting frame still sees a target
    run(v, 0.05);
    assert.equal(v.viewDir, 'UP', 'a target is there: keep facing it');
    v.setHasTarget(false);                           // nothing in range any more
    run(v, 0.05);
    assert.equal(v.viewDir, null, 'the clip is over and there is nothing to face: back at once, no extra delay');
  });
});
describe('a skill drives the facing while it runs (野鬃 S2 / 深巡 S2 keep the deployed direction)', () => {
  test('the resolver takes the skill row: Skill_2 covers the loop that actually plays', () => {
    const { faceModeFor } = mods();
    const wild = FACE_MODES.char_496_wildmn;          // rows: Attack / Skill_1_Loop / Skill_2 (the cast, no _Loop row)
    const deep = FACE_MODES.char_4137_udflow;          // rows: Skill_2_Loop / Attack / Skill_2_Loop
    const flags = (row) => faceModeFlags(row && row[1]);
    // during the skill: the skill row, which keeps the deployed direction
    assert.ok(flags(faceModeFor(wild, ['Skill_2_Loop', 'Skill_2', 'Attack'])).def, '野鬃 S2 -> Default');
    assert.ok(flags(faceModeFor(deep, ['Skill_2_Loop', 'Skill_2', 'Attack'])).def, '深巡 S2 -> Default');
    // without a skill: the attack row still turns toward the target
    assert.ok(flags(faceModeFor(wild, ['Attack'])).target);
    assert.ok(flags(faceModeFor(deep, ['Attack'])).target);
  });

  for (const id of ['char_496_wildmn', 'char_4137_udflow']) {
    test(`${id}: during S2 the model goes back to the deployed direction and does not turn`, async () => {
      const v = await view(id, { dir: 'RIGHT', skillIndex: 2 });
      // first attack while no skill runs: the model turns toward the target (the attack row is Target)
      assert.equal(v.windUp(0.4, 'none'), true);
      assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), true);
      assert.equal(v.viewDir, 'LEFT');
      // the skill comes on: its row keeps the facing, so the model turns back to the deployed direction at once
      v.setSkill(true);
      assert.equal(v.viewDir, null, 'deployed direction again for the whole skill');
      await tick();
      // and no attack during the skill may turn it
      assert.equal(v.windUp(0.4, 'none'), true);
      assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), false, 'S2 keeps the deployed direction');
      assert.equal(v.viewDir, null);
      // the skill ends: the attack row is back in charge
      v.setSkill(false);
      await tick();
      assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), true, 'after the skill the model turns again');
      assert.equal(v.viewDir, 'LEFT');
    });
  }
});
describe('the sim skill slot decides, not whatever skill clip the client happens to play', () => {
  test('野鬃 S2 keeps the deployed direction even if the wrong skill slot is playing', async () => {
    // the client's clip slot can lag behind the sim (a separate known bug); the face mode must not follow the wrong slot
    const v = await view('char_496_wildmn', { dir: 'RIGHT', skillIndex: 2 });
    v.setSkill(true);
    await tick();
    // pretend the actor is still on skill 1's loop (Target) while the sim says S2
    if (v.actor) { v.actor.current = 'Skill_1_Loop'; }
    assert.equal(v.windUp(0.4, 'none'), true);
    assert.equal(v.faceTarget(at(1, 9), false, { lead: 0.4 }), false, 'no turn: the sim says S2, which keeps the facing');
    assert.equal(v.viewDir, null);
  });
});
