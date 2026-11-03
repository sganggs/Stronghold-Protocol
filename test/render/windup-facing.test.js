// An enemy's attack wind-up faces its target when the clip starts (GitHub #869, DESIGN §37.54).
//
// The look-ahead (render/app/windup.js) starts the Attack clip ahead of the 'atk' event so the hit frame lines up.
// Facing used to wait for UnitView.onAttack, so a blocker redeployed behind a walking enemy (重装防御者) was swung
// at while the model still faced the old walk. The wind-up now uses onAttack's rule (|dx| > 0.1) the moment the
// clip starts. Headless fake PIXI (test/render/fakepixi.js); the clip's hit is the shield defender's Attack hit
// (data/assets.json, 0.467 s of a 1 s clip) so a 0.2 s lead starts it and a longer lead does not.
//
//   node --test test/render/windup-facing.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, UnitView;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('prep', { width: 1280, height: 720 });

function store() {
  const entry = {
    skel: '/s/front.skel', atlas: '/s/front.atlas',
    anims: { idle: 'Idle', attack: { loop: 'Attack' }, move: { loop: 'Move' }, die: 'Die' },
    animations: { Idle: 2, Attack: 1, Move: 1, Die: 0.9 }, hits: { Attack: [0.467] },
  };
  return {
    picture: () => null, image: async () => null, hasBack: () => false,
    spineEntry: () => entry,
    spine: { acquire: async () => ({ animations: [{ name: 'Idle' }, { name: 'Attack' }, { name: 'Move' }, { name: 'Die' }] }), release() {} },
  };
}

async function unit(info) {
  const ctx = fakeViewCtx(fake.P, { assets: store(), cam });
  const v = new UnitView(ctx, {
    id: 1, side: 'enemy', kind: 'enemy', defId: 'enemy_1006_shield', x: 5, y: 12, maxHp: 100, ...info,
  });
  await tick(); await tick();
  assert.ok(v.spineReady && v.actor, 'spine actor built');
  return v;
}

const stand = (x, vx = 0) => ({ x, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: vx ? 1 : 0, vx });

test('a shield defender winding up at a blocker behind it faces that blocker, then a standing sync keeps the turn', async () => {
  const v = await unit({});
  v.sync(stand(5, -1.2));
  assert.equal(v.visFacing, -1, 'walking left');
  const behind = { x: 8, y: 12 };
  assert.equal(v.windUp(0.2, 'none', null, v.atkInterval, behind), true, 'the clip starts 0.2 s ahead of the strike');
  assert.equal(v.actor.current, 'Attack');
  assert.equal(v.visFacing, 1, 'faces the blocker on its right as the wind-up starts');
  v.sync(stand(5, 0));
  assert.equal(v.visFacing, 1, 'a block freezes vx, so the wind-up facing stays until the strike');
  v.onAttack(behind, 1.433, 'none');
  assert.equal(v.visFacing, 1, 'the strike uses the same rule');
});

test('the other way, a target within 0.1 tile, and a wind-up that has not started, leave the old facing', async () => {
  const early = await unit({});
  early.sync(stand(5, -1));
  assert.equal(early.windUp(2, 'none', null, 1, { x: 8, y: 12 }), false, 'lead longer than the hit: the clip waits');
  assert.equal(early.actor.current !== 'Attack', true);
  assert.equal(early.visFacing, -1, 'no turn before the clip starts');

  const near = await unit({});
  near.sync(stand(5, -1));
  assert.equal(near.windUp(0.2, 'none', null, 1, { x: near.x + 0.05, y: 12 }), true);
  assert.equal(near.visFacing, -1, 'straight ahead: onAttack does not turn either');

  const left = await unit({ x: 16 });
  left.sync(stand(16, 1.2));
  assert.equal(left.visFacing, 1, 'walking right on the right half');
  assert.equal(left.windUp(0.2, 'none', null, 1, { x: 13, y: 12 }), true);
  assert.equal(left.visFacing, -1, 'a smaller display x is to the left, mirrored boss half included');

  const none = await unit({});
  none.sync(stand(5, -1));
  assert.equal(none.windUp(0.2, 'none', null, 1, null), true);
  assert.equal(none.visFacing, -1, 'no target: stay as the walk left it');
});

test('an operator keeps its deploy direction, and a fixed-facing leader does not turn', async () => {
  const op = await unit({ side: 'ally', kind: 'chess', defId: 'char_x', dir: 'LEFT', facing: -1 });
  assert.equal(op.isEnemy, false);
  assert.equal(op.visFacing, -1);
  assert.equal(op.windUp(0.2, 'none', null, 1, { x: 9, y: 12 }), true);
  assert.equal(op.actor.current, 'Attack');
  assert.equal(op.visFacing, -1, 'operators keep their deploy direction');

  const boss = await unit({ defId: 'enemy_9013_acstmk', x: 8 });
  assert.equal(boss.visFacing, 1, 'FIXED_FACING draws this leader to the right');
  assert.equal(boss.windUp(0.2, 'none', null, 1, { x: 4, y: 12 }), true);
  assert.equal(boss.visFacing, 1, 'the wind-up does not override a fixed facing');
});

test('a mirrored enemy model still flips from the same visFacing the attack uses', async () => {
  const v = await unit({});
  v.mirrorX = true;
  v.sync(stand(5, -1));
  assert.equal(v.windUp(0.2, 'none', null, 1, { x: 8, y: 12 }), true);
  assert.equal(v.visFacing, 1);
  assert.equal(v.modelFlip(), -1, 'mirrorX still mirrors the draw; the facing sign is the attack\'s');
});

test('the look-ahead passes the queued attack\'s target view into windUp and castStart', async () => {
  const { createWindUpLookahead } = await import('../../public/js/render/app/windup.js');
  const calls = [];
  const casts = [];
  const enemy = {
    windUp(lead, kind, slot, interval, target) {
      calls.push({ lead: Math.round(lead * 1000) / 1000, kind, slot, interval, target });
      return true;
    },
  };
  const blocker = { id: 2, x: 8, y: 12 };
  const views = new Map([[1, enemy], [2, blocker]]);
  const la = createWindUpLookahead({
    views, woundUp: new WeakSet(), castStart: (v, tv) => casts.push(tv),
  });
  const atk = ['atk', 1, 2, 'none'];
  const queue = {
    forEachUpcoming(a, b, fn) {
      if (1.433 > a && 1.433 <= b) fn(atk, 1.433);
    },
  };
  la.run(queue, 0.993);
  assert.deepEqual(calls, [{ lead: 0.44, kind: 'none', slot: null, interval: undefined, target: blocker }]);
  assert.equal(casts[0], blocker, 'the cast effects see the same target');
  la.run(queue, 1.0);
  assert.equal(calls.length, 1, 'a wound-up attack is not started again');
});
