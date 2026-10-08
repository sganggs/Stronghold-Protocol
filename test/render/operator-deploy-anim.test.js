// test/render/operator-deploy-anim.test.js — verification of operator deploy animation triggers and landing sfx.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, UnitView;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const cam = () => presetCamera('prep', { width: 1280, height: 720 });

function makeStore({ spineDelay = 0 } = {}) {
  const entryFront = {
    skel: '/s/op.skel', atlas: '/s/op.atlas', textures: ['/s/op.png'],
    anims: { idle: 'Idle', deploy: 'Start', die: 'Die', attack: { begin: null, loop: 'Attack', end: null } },
    animations: { Idle: 1, Start: 1, Die: 1, Attack: 1 },
  };
  const entryBack = {
    skel: '/s/op_b.skel', atlas: '/s/op_b.atlas', textures: ['/s/op_b.png'],
    anims: { idle: 'Idle', deploy: 'Start', die: 'Die', attack: { begin: null, loop: 'Attack', end: null } },
    animations: { Idle: 1, Start: 1, Die: 1, Attack: 1 },
  };
  return {
    picture: (id) => `/pic/${id}.png`,
    image: async () => ({ width: 180, height: 180 }),
    imageNow: () => ({ width: 180, height: 180 }),
    hasBack: () => true,
    spineEntry: (_id, opts) => (opts?.back ? entryBack : entryFront),
    spine: {
      acquire: async () => {
        if (spineDelay > 0) await new Promise((r) => setTimeout(r, spineDelay));
        return {
          animations: [
            { name: 'Idle' },
            { name: 'Start' },
            { name: 'Die' },
            { name: 'Attack' },
          ],
        };
      },
      release() {},
    },
  };
}

function makeAudioMock() {
  const calls = [];
  return {
    calls,
    battle(name, opts) {
      calls.push({ type: 'battle', name, opts });
    },
    unit(def, kind, id) {
      calls.push({ type: 'unit', def, kind, id });
      return false; // fall back to battle('deploy')
    },
  };
}

describe('Operator deploy animation & landing sound', () => {
  test('onDeploy before spine model loads sets _deployPending, plays deploy and sound on load', async () => {
    const assets = makeStore({ spineDelay: 10 });
    const audio = makeAudioMock();
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    ctx.audio = audio;
    const v = new UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId: 'char_op', tier: 3, x: 5, y: 12, maxHp: 1000, dir: 'RIGHT' }, { prep: true });

    assert.equal(v.actor, null, 'actor not yet loaded');
    v.onDeploy();
    assert.equal(v._deployPending, true, 'deploy marked pending');
    assert.equal(audio.calls.length, 0, 'no sound played while loading');

    // Wait for spine to load
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(v.actor, 'actor loaded');
    assert.equal(v.actor.mode, 'deploy', 'actor played deploy animation on load');
    assert.equal(v._deployPending, false, 'deploy pending cleared');
    assert.ok(audio.calls.some((c) => c.name === 'deploy'), 'landing sound played on load');
  });

  test('facing preview via setDir only displays idle and does NOT trigger deploy or sound', async () => {
    const assets = makeStore({ spineDelay: 0 });
    const audio = makeAudioMock();
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    ctx.audio = audio;
    const v = new UnitView(ctx, { id: 2, side: 'ally', kind: 'chess', defId: 'char_op', tier: 3, x: 5, y: 12, maxHp: 1000, dir: 'RIGHT' }, { prep: true });

    await new Promise((r) => setImmediate(r));
    assert.ok(v.actor, 'actor loaded');
    audio.calls.length = 0; // clear any init sound

    v.actor.update(1.5);
    assert.equal(v.actor.mode, 'base', 'actor in idle mode');

    // Change direction to LEFT (preview)
    v.setDir('LEFT');
    assert.equal(v.dir, 'LEFT');
    assert.equal(v.actor.mode, 'base', 'facing preview stays in idle/base mode');
    assert.equal(audio.calls.length, 0, 'no sound on facing preview');

    // Change direction to UP (swaps to Back model)
    v.setDir('UP');
    await new Promise((r) => setImmediate(r));
    assert.equal(v.dir, 'UP');
    assert.ok(v.entryBack, 'using Back model');
    assert.equal(v.actor.mode, 'base', 'Back model stays in idle/base mode during preview');
    assert.equal(audio.calls.length, 0, 'no sound on facing preview with model swap');
  });

  test('confirming deployment plays deploy animation and landing sound', async () => {
    const assets = makeStore({ spineDelay: 0 });
    const audio = makeAudioMock();
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    ctx.audio = audio;
    const v = new UnitView(ctx, { id: 3, side: 'ally', kind: 'chess', defId: 'char_op', tier: 3, x: 5, y: 12, maxHp: 1000, dir: 'UP' }, { prep: true });

    await new Promise((r) => setImmediate(r));
    assert.ok(v.actor);
    audio.calls.length = 0;

    v.onDeploy();
    assert.equal(v.actor.mode, 'deploy', 'deploy played upon confirmation');
    assert.ok(audio.calls.some((c) => c.name === 'deploy'), 'landing sound played upon confirmation');
  });

  test('deploySequence plays start animation and sound with delay between units', async () => {
    const assets = makeStore({ spineDelay: 0 });
    const audio = makeAudioMock();
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    ctx.audio = audio;

    const v1 = new UnitView(ctx, { id: 10, side: 'ally', kind: 'chess', defId: 'char_op1', tier: 3, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT' }, { prep: true });
    const v2 = new UnitView(ctx, { id: 11, side: 'ally', kind: 'chess', defId: 'char_op2', tier: 3, x: 6, y: 10, maxHp: 1000, dir: 'RIGHT' }, { prep: true });
    await new Promise((r) => setImmediate(r));

    v1.actor.update(1.5);
    v2.actor.update(1.5);
    assert.equal(v1.actor.mode, 'base');
    assert.equal(v2.actor.mode, 'base');
    audio.calls.length = 0;

    // Simulate deploy sequence: v1 at 0ms, v2 at 50ms
    v1.onDeploy(true);
    assert.equal(v1.actor.mode, 'deploy');
    assert.equal(v2.actor.mode, 'base');

    await new Promise((r) => setTimeout(r, 50));
    v2.onDeploy(true);
    assert.equal(v2.actor.mode, 'deploy');

    const deploySounds = audio.calls.filter((c) => c.name === 'deploy');
    assert.equal(deploySounds.length, 2, 'two deploy landing sounds played 50ms apart');
  });
});
