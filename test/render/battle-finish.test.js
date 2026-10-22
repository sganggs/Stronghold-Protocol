import test from 'node:test';
import assert from 'node:assert/strict';
import { BattlePresentation } from '../../public/js/render/battlePresentation.js';
import { ANIM, UF } from '../../shared/constants.js';

test('completion drains buffered events before idling, then advances only presentation time', () => {
  const p = new BattlePresentation();
  p.finish();
  assert.equal(p.update(9.9, 10, 0.1), false);
  assert.equal(p.ended, false);
  assert.equal(p.update(10, 10, 0.1), true);
  assert.equal(p.ended, true);
  const sample = { hp: 10, anim: ANIM.SKILL, flags: UF.SKILL | UF.FROZEN, vx: 1, vy: 1, x: 4, y: 5 };
  assert.deepEqual(p.sample(sample), { ...sample, anim: ANIM.IDLE, flags: 0, vx: 0, vy: 0 });
  p.update(10, 10, 0.1);
  assert.equal(p.tail, 0.2);
  const dead = { ...sample, hp: 0, anim: ANIM.DIE };
  assert.equal(p.sample(dead), dead, 'death poses are preserved');
  p.reset();
  assert.equal(p.ended, false);
  assert.equal(p.sample(sample), sample);
});

test('a paused or stalled feed never implies completion; studio zero steps do not run the tail', () => {
  const p = new BattlePresentation();
  for (let i = 0; i < 100; i++) p.update(10, 10, 0.1);
  assert.equal(p.ended, false);
  p.finish();
  p.update(10, 10, 0);
  for (let i = 0; i < 100; i++) p.update(10, 10, 0);
  assert.equal(p.tail, 0);
});

test('an actual frozen unit leaves its held pose and keeps animating idle after completion', async () => {
  const { installFakePixi, fakeViewCtx } = await import('./fakepixi.js');
  const fake = installFakePixi();
  try {
    const { UnitView, syncView } = await import('../../public/js/render/units.js');
    const { SpineActor } = await import('../../public/js/render/spine.js');
    const v = new UnitView(fakeViewCtx(fake.P), { id: 1, side: 'ally', kind: 'chess', x: 4, y: 5, maxHp: 100 });
    const a = new SpineActor({ animations: [{ name: 'Idle' }] }, { anims: { idle: 'Idle' }, animations: { Idle: 1 } });
    v.actor = a;
    const s = { x: 4, y: 5, hp: 100, maxHp: 100, sp: 0, spMax: 10, flags: UF.FROZEN | UF.SKILL, anim: ANIM.STUN, vx: 0, vy: 0 };
    syncView(v, s, 10);
    assert.equal(a.frozen, true);
    const p = new BattlePresentation(); p.finish(); p.update(10, 10, 0.1);
    syncView(v, p.sample(s), 10);
    a.update(0.1);
    assert.equal(a.frozen, false);
    assert.equal(a.skillOn, false);
    assert.equal(a.current, 'Idle');
    assert.equal(v.flags, 0);
    v.destroy();
  } finally { fake.restore(); }
});

test('official completion cancels late loads and persistent loops but lets a hit finish', async () => {
  const { OfficialFx } = await import('../../public/js/render/vfx/system.js');
  let stopped = 0;
  const pending = { cancelled: false };
  const sys = Object.create(OfficialFx.prototype);
  sys.pending = [pending]; sys.timers = [{ fn() { throw new Error('must not run'); } }];
  sys.effects = [
    { def: {}, handle: { opts: { loop: true } }, stop() { stopped++; } },
    { def: { isLoop: false, loops: true }, stop() { stopped++; } },
    { def: {}, stop() { throw new Error('one-shot must finish naturally'); } },
  ];
  sys.finish();
  assert.equal(stopped, 2);
  assert.equal(pending.cancelled, true);
  assert.equal(sys.pending.length, 0);
  assert.equal(sys.timers.length, 0);
});


test('completion preserves flight and the stealth-driven enemy form while releasing crowd control', async () => {
  const { installFakePixi, fakeViewCtx } = await import('./fakepixi.js');
  const fake = installFakePixi();
  try {
    const { UnitView, syncView } = await import('../../public/js/render/units.js');
    const v = new UnitView(fakeViewCtx(fake.P), { id: 2, side: 'enemy', kind: 'enemy', defId: 'enemy_9008_acbunn', x: 4, y: 5, maxHp: 100 });
    const sample = { x: 4, y: 5, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: UF.FLYING | UF.STEALTH | UF.FROZEN | UF.SKILL | UF.SHIELD | UF.INVULN, anim: ANIM.STUN, vx: 1, vy: 0 };
    syncView(v, sample, 10);
    assert.equal(v.flying, true);
    assert.equal(v.form, null);
    const p = new BattlePresentation(); p.finish(); p.update(10, 10, 0.1);
    syncView(v, p.sample(sample), 10);
    assert.equal(v.flying, true, 'a snapshot-only flyer stays aloft after completion');
    assert.equal(v.form, null, 'the stealth-driven three-head form stays unchanged');
    assert.equal(v.flags, UF.FLYING | UF.STEALTH | UF.SHIELD | UF.INVULN);
    assert.equal(v.anim, ANIM.IDLE);
    v.destroy();
  } finally { fake.restore(); }
});
