// test/render/feedback143-splash-ring.test.js — GitHub #143 「大部分aoe圈特效过于明显…建议减小所有aoe圈边的宽度」: the
// remake's own rings around a hit and a zone. A splash attacker's hit (fx/numbers.js SPLASH_SUBS) draws its ground ring
// only when no official hit effect drew that hit (`noSpark`: the client draws no ring beside its own hit), and then as a
// thin 'shock' ring starting at SPLASH_RING.a0 instead of the wide full-alpha 'ring' band; a zone's edge (fx/zones.js) is
// the thin ring at the lowered ZONE_ALPHA, a telegraph keeps its wide band. Against the headless fake PIXI
// (test/render/fakepixi.js), like feedback1e-splash.test.js. History §37.327.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, FX, NUM, ZONES;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
  NUM = await import('../../public/js/render/fx/numbers.js');
  ZONES = await import('../../public/js/render/fx/zones.js');
});
after(() => fake.restore());

const cam = presetCamera('normal', { width: 1600, height: 900 });
const unit = (id, x, y, defId = 'x') => ({ id, x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, maxHp: 1000, info: { defId }, onHit() {} });

function system(sub = 'splashcaster') {
  const caster = unit(1, 3, 10, 'caster'), foe = unit(20, 7, 10), foe2 = unit(21, 8, 11);
  const map = new Map([[caster.id, caster], [foe.id, foe], [foe2.id, foe2]]);
  const ctx = fakeViewCtx(fake.P);
  const fx = new FX.FxSystem({
    P: fake.P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality: 'high', damageNumbers: true },
    timeScale: () => 2, loadLevel: () => 0, subProfOf: (defId) => (defId === 'caster' ? sub : null), view: (id) => map.get(id) || null,
    screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
  });
  return { fx, caster, foe, foe2 };
}

test('an official hit (noSpark) draws no splash ring; without one the ring is the thin shockwave at a lower alpha', () => {
  const { fx, caster, foe } = system();
  fx.damage(foe, 50, 'arts', caster, null, { noSpark: true });
  assert.equal(fx.rings.length, 0, 'the official hit effect stands alone (#143: the ring was drawn over it)');
  fx.damage(foe, 50, 'arts', caster, null);
  assert.equal(fx.rings.length, 1);
  const r = fx.rings[0];
  assert.equal(r.sp.texture, fx.tex.shock, "the thin 'shock' ring, not the wide 'ring' band");
  assert.equal(r.r1, NUM.SPLASH_RING.r);
  fx.update(1 / 120);
  assert.ok(r.sp.alpha > 0 && r.sp.alpha <= NUM.SPLASH_RING.a0, `its first frame at ≤ ${NUM.SPLASH_RING.a0}: ${r.sp.alpha}`);
  assert.ok(NUM.SPLASH_RING.a0 < 1 && NUM.SPLASH_RING.a0 >= 0.4, 'subtler, still readable');
});

test('a non-splash attacker draws no ring; the throttle still keeps one ring per SPLASH_RING.gap on the screen', () => {
  const plain = system('primcaster');
  plain.fx.damage(plain.foe, 50, 'arts', plain.caster, null);
  assert.equal(plain.fx.rings.length, 0);
  const { fx, caster, foe, foe2 } = system();
  fx.damage(foe, 50, 'arts', caster, null);
  fx.damage(foe2, 50, 'arts', caster, null);
  assert.equal(fx.rings.length, 1, 'two hits in one moment: one ring');
  for (let t = 0; t < NUM.SPLASH_RING.gap + 0.02; t += 1 / 120) fx.update(1 / 120);
  fx.damage(foe2, 50, 'arts', caster, null);
  assert.ok(fx.rings.some((r) => r.x === foe2.x), 'after the gap, the next hit rings again');
});

test("a ring's start alpha scales its whole fade; the default stays 1 (every other ring unchanged)", () => {
  const { fx } = system();
  fx.ring(5, 10, 0, 0.1, 1, 0xffffff, 0.4);
  fx.ring(6, 10, 0, 0.1, 1, 0xffffff, 0.4, 'ring', null, 0.5);
  fx.update(0.1);
  const [full, half] = fx.rings;
  assert.ok(Math.abs(half.sp.alpha - full.sp.alpha * 0.5) < 1e-9, `${half.sp.alpha} = ½ × ${full.sp.alpha}`);
});

test("a zone's edge is the thin ring at the lowered alpha; a telegraph keeps the wide band at its strength", () => {
  const { fx } = system();
  assert.deepEqual(ZONES.ZONE_ALPHA.short, [0.28, 0.6]);
  assert.deepEqual(ZONES.ZONE_ALPHA.persist, [0.16, 0.4]);
  assert.deepEqual(ZONES.ZONE_ALPHA.warn, [0.35, 0.75], 'a warning stays as bold as before');
  fx.simFx('zone', 5, 10, { id: 9, r: 1.5, duration: 11 });       // a 炼金单元 (persistent)
  fx.simFx('zone', 12, 10, { id: 9, r: 1.5, duration: 1 });       // a short burst
  fx.zone(15, 10, 0, 1.5, 0xff4040, 2, 'soft', true);              // a telegraph
  const [persist, short, warn] = fx.zones;
  assert.equal(persist.edge.texture, fx.tex.shock);
  assert.equal(short.edge.texture, fx.tex.shock);
  assert.equal(warn.edge.texture, fx.tex.ring);
  fx._updateZones(0.3);   // past the 0.25 s growth, before any fade
  assert.ok(persist.edge.alpha <= ZONES.ZONE_ALPHA.persist[1] + 1e-9 && persist.edge.alpha > 0.25, `persist edge ${persist.edge.alpha}`);
  assert.ok(persist.disc.alpha <= ZONES.ZONE_ALPHA.persist[0] + 1e-9, 'the disc unchanged');
});
