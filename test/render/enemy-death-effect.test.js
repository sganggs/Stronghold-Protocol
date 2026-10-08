// test/render/enemy-death-effect.test.js — verification of enemy death fade and darken effects.

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
  const entry = {
    skel: '/s/enemy.skel',
    atlas: '/s/enemy.atlas',
    textures: ['/s/enemy.png'],
    anims: {
      idle: 'Idle',
      die: 'Die',
      attack: { begin: null, loop: 'Attack', end: null },
    },
    animations: { Idle: 1, Die: 1, Attack: 1 },
  };
  return {
    picture: (id) => `/pic/${id}.png`,
    image: async () => ({ width: 180, height: 180 }),
    imageNow: () => ({ width: 180, height: 180 }),
    spineEntry: () => entry,
    spine: {
      acquire: async () => {
        if (spineDelay > 0) await new Promise((r) => setTimeout(r, spineDelay));
        return {
          animations: [
            { name: 'Idle' },
            { name: 'Die' },
            { name: 'Attack' },
          ],
        };
      },
      release() {},
    },
  };
}

describe('Enemy death color darkening and opacity fading', () => {
  test('enemy dying darkens tint towards 0x000000 and fades alpha to 0', async () => {
    const assets = makeStore({ spineDelay: 0 });
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    const e = new UnitView(ctx, { id: 10, side: 'enemy', kind: 'enemy', defId: 'enemy_1000_slug', tier: 1, x: 5, y: 12, maxHp: 1000 });

    await new Promise((r) => setImmediate(r));
    assert.ok(e.actor, 'enemy actor loaded');

    // Advance until fully faded in
    for (let i = 0; i < 20; i++) e.update(1 / 60, cam(), i / 60);
    assert.equal(e.alive, true);
    assert.equal(e.alpha, 1);
    assert.equal(e._tint, 0xffffff);

    // Enemy dies
    e.die();
    assert.equal(e.alive, false);
    assert.ok(e.dying > 0, 'dying duration set');
    const totalDieDur = e.dieDur;

    // Advance 30% of death duration
    e.update(totalDieDur * 0.3, cam(), 0.3);
    assert.ok(e.alpha < 1 && e.alpha > 0.4, `alpha is fading (${e.alpha})`);
    assert.ok(e._tint < 0xffffff, `tint has darkened (${e._tint.toString(16)})`);

    // Advance to 75% of death duration
    e.update(totalDieDur * 0.45, cam(), 0.75);
    assert.ok(e.alpha < 0.4, `alpha is significantly faded (${e.alpha})`);
    const r75 = (e._tint >> 16) & 255;
    const g75 = (e._tint >> 8) & 255;
    const b75 = e._tint & 255;
    assert.ok(r75 < 50 && g75 < 50 && b75 < 50, `tint is very dark black (${e._tint.toString(16)})`);

    // Finish death duration
    e.update(totalDieDur * 0.3, cam(), 1.05);
    assert.equal(e.dying, 0);
    assert.equal(e.remove, true, 'marked for removal');
    assert.equal(e.alpha, 0, 'fully transparent');
  });

  test('enemy diamond fallback tint darkens towards black when dying', async () => {
    const assets = {
      picture: () => null,
      spineEntry: () => null, // No spine model, use fallback diamond
    };
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    const e = new UnitView(ctx, { id: 30, side: 'enemy', kind: 'enemy', defId: 'enemy_nosym', tier: 1, x: 5, y: 12, maxHp: 1000 });

    for (let i = 0; i < 20; i++) e.update(1 / 60, cam(), i / 60);
    assert.equal(e.alive, true);
    assert.equal(e.actor, null);

    e.die();
    assert.equal(e.alive, false);
    const total = e.dieDur;

    // Advance halfway
    e.update(total * 0.5, cam(), 0.5);
    assert.ok(e.fallback.tint < 0xffffff, `fallback tint is darkened (${e.fallback.tint.toString(16)})`);

    // Advance near end (85%)
    e.update(total * 0.35, cam(), 0.85);
    const r = (e.fallback.tint >> 16) & 255;
    const g = (e.fallback.tint >> 8) & 255;
    const b = e.fallback.tint & 255;
    assert.ok(r < 50 && g < 50 && b < 50, `fallback tint is near black (${e.fallback.tint.toString(16)})`);
  });

  test('ally unit dying without down does not darken towards black', async () => {
    const assets = makeStore({ spineDelay: 0 });
    const ctx = fakeViewCtx(fake.P, { assets, cam });
    const a = new UnitView(ctx, { id: 20, side: 'ally', kind: 'chess', defId: 'char_op', tier: 3, x: 5, y: 12, maxHp: 1000 });

    await new Promise((r) => setImmediate(r));
    assert.ok(a.actor);

    for (let i = 0; i < 20; i++) a.update(1 / 60, cam(), i / 60);
    a.die();
    a.update(0.3, cam(), 0.3);
    assert.equal(a._tint, 0xffffff, 'ally tint remains baseTint (0xffffff), not darkened to black');
  });
});
