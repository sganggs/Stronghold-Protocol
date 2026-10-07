// test/render/fxproj.test.js — battle FX of render/fx.js against a headless fake PIXI (test/render/fakepixi.js):
//   * projectile speeds follow the sim (style.js PROJ mirrors server/sim/constants.js; the live table wins)
//   * the FX atlas layout (render/textures.js fxFrames): no two frames share a pixel (the light pillar used to run into
//     the status-icon row), frame sizes other modules scale by are kept
//   * pooled particles: a freed sprite is a zero-size transparent quad (Pixi's ParticleRenderer ignores `visible`) and
//     its record is reused — a steady stream of shots stops allocating sprites
//   * shots: flight time = distance / sim speed / clock rate, homing on the moving target, one arrival burst, then gone
//   * 回环射手 boomerang: out at the sim's speed, back to the thrower's CURRENT position at the return speed, caught there;
//     dropped when the thrower is gone
//   * 蕾缪安 S3: a lock reticle follows its enemy until the 'bombard' of the shell fired at it; 'bombardShell' flies for
//     `t` game s — however long the S3 runs (extra ammo, stuns); blasts named after the shooter happen at their (x, y);
//     the S2 aim lock ends with its 'crit'; a lock of a shooter gone quiet times out
//   * fx anchoring (_where), quality / load gating of cosmetic particles, melee slash direction, skill burst + aura

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as SIM from '../../server/sim/constants.js';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { PROJ, HIT_TINT } from '../../public/js/render/style.js';
import { UF } from '../../shared/constants.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { renderInfo } from '../../public/js/render/app/info.js';
import { SnapshotBuffer } from '../../public/js/render/interp.js';

let fake, FX, T, UnitView;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
  T = await import('../../public/js/render/textures.js');
  ({ UnitView } = await import('../../public/js/render/units.js'));
});
after(() => { FX?.setSimProjectileSpeeds(null); fake.restore(); });

const DT = 1 / 120;
const cam = presetCamera('normal', { width: 1600, height: 900 });

/** A unit view as the FX system reads it. */
function unit(id, x, y, o = {}) {
  return { id, x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, isEnemy: false, maxHp: 3000, info: { defId: 'char_x' }, onHit() {}, ...o };
}

/** A FxSystem on fake layers; `views` resolves fx ids; ts = battle clock rate. */
function makeFx({ quality = 'high', ts = 2, load = 0, views = [] } = {}) {
  const P = fake.P;
  const ctx = fakeViewCtx(P);
  const map = new Map(views.map((v) => [v.id, v]));
  const fx = new FX.FxSystem({
    P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality, damageNumbers: true },
    timeScale: () => ts, loadLevel: () => load, subProfOf: () => null, view: (id) => map.get(id) || null,
    screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
  });
  return { fx, map };
}

const run = (fx, seconds, dt = DT) => { for (let t = 0; t < seconds - 1e-9; t += dt) fx.update(dt); };
const texName = (fx, tex) => Object.keys(fx.tex).find((k) => fx.tex[k] === tex);
const liveTex = (fx, name) => fx.parts.filter((p) => p.sp.texture === fx.tex[name]);

describe('projectile speeds follow the sim', () => {
  test('style.js PROJ mirrors PROJECTILE_SPEEDS for every sim kind (and the boomerang return speed)', () => {
    for (const [kind, v] of Object.entries(SIM.PROJECTILE_SPEEDS)) {
      assert.ok(PROJ[kind], `render/style.js PROJ has no visual for the sim's projectile kind '${kind}'`);
      assert.equal(PROJ[kind].speed, v, `PROJ.${kind}.speed ${PROJ[kind].speed} ≠ sim PROJECTILE_SPEEDS.${kind} ${v}: update the mirror`);
    }
    if (SIM.BOOMERANG_RETURN_SPEED !== undefined) assert.equal(PROJ.boomerang.back, SIM.BOOMERANG_RETURN_SPEED, 'PROJ.boomerang.back mirrors BOOMERANG_RETURN_SPEED');
  });

  test('projSpeed: the live sim table first, then the style.js copy; boomerangReturn = the return speed', () => {
    FX.setSimProjectileSpeeds(null);
    assert.equal(FX.projSpeed('orb'), PROJ.orb.speed);
    assert.equal(FX.projSpeed('boomerangReturn'), PROJ.boomerang.back);
    assert.equal(FX.projSpeed('nope'), 12);
    FX.setSimProjectileSpeeds({ ...SIM.PROJECTILE_SPEEDS, orb: 99, boomerang: 20 }, 5);
    assert.equal(FX.projSpeed('orb'), 99);
    assert.equal(FX.projSpeed('boomerang'), 20);
    assert.equal(FX.projSpeed('boomerangReturn'), 5);
    FX.setSimProjectileSpeeds({ arrow: 1 });   // an older sim table: the rest from the copy
    assert.equal(FX.projSpeed('arrow'), 1);
    assert.equal(FX.projSpeed('bolt'), PROJ.bolt.speed);
    assert.equal(FX.projSpeed('boomerangReturn'), PROJ.boomerang.back);
    FX.setSimProjectileSpeeds(SIM.PROJECTILE_SPEEDS, SIM.BOOMERANG_RETURN_SPEED);
    for (const [k, v] of Object.entries(SIM.PROJECTILE_SPEEDS)) assert.equal(FX.projSpeed(k), v);
    FX.setSimProjectileSpeeds(null);
  });
});

describe('FX atlas layout', () => {
  test('frames never overlap and stay inside the atlas; shared frame sizes are kept', () => {
    const { size: [W, H], frames } = T.fxFrames();
    const list = Object.entries(frames);
    for (const [name, [x, y, w, h]] of list) assert.ok(x >= 0 && y >= 0 && x + w <= W && y + h <= H, `${name} inside ${W}×${H}`);
    const hits = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, [ax, ay, aw, ah]] = list[i], [b, [bx, by, bw, bh]] = list[j];
        if (ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah) hits.push(`${a} × ${b}`);
      }
    }
    assert.deepEqual(hits, [], 'overlapping FX atlas frames');
    // sizes other modules scale sprites by (units.js glow / chevron, tiles.js soft / ring / dot / smoke, app.js coin)
    const size = (n) => frames[n].slice(2).join('×');
    for (const [n, s] of [['glow', '128×128'], ['soft', '128×128'], ['ring', '128×128'], ['hex', '128×128'], ['smoke', '128×128'], ['dot', '32×32'], ['chevron', '64×64'], ['coin', '48×48'], ['pillar', '64×256'], ['streak', '128×32'], ['slash', '128×64']]) assert.equal(size(n), s, n);
    for (const k of T.STATUS_KEYS) assert.equal(size('st_' + k), '32×32', k);
    for (const n of ['tracer', 'shock', 'reticle', 'flare', 'boomerang', 'muzzle']) assert.ok(frames[n], `new frame ${n}`);
  });

  test('fxAtlas builds one texture per frame on one base texture', () => {
    const a = T.fxAtlas();
    const { frames } = T.fxFrames();
    assert.deepEqual(Object.keys(a.tex).sort(), Object.keys(frames).sort());
    for (const t of Object.values(a.tex)) assert.equal(t.baseTexture, a.base);
  });
});

describe('particles', () => {
  test('a freed particle is a zero-size transparent quad and its record is reused', () => {
    const { fx } = makeFx();
    const p = fx.particle('glow', 10, 10, { life: 0.05, s0: 1, a0: 1, a1: 1 });
    const sp = p.sp;
    run(fx, 0.1);
    assert.equal(fx.parts.length, 0);
    assert.equal(sp.alpha, 0, 'alpha 0 (the particle renderer draws invisible children too)');
    assert.deepEqual([sp.scale.x, sp.scale.y], [0, 0], 'zero size: no fill cost');
    const n = fx.addPc.children.length;
    const q = fx.particle('spark', 5, 5, { life: 0.3 });
    assert.equal(q, p, 'the pooled record comes back');
    assert.equal(fx.addPc.children.length, n, 'no new sprite');
    assert.equal(q.sp.texture, fx.tex.spark);
    assert.ok(q.sp.alpha > 0 && q.sp.scale.x > 0);
  });

  test('a steady stream of shots and hits only ever makes as many sprites as were alive at once', () => {
    const a = unit(1, 3, 10), b = unit(2, 8, 11, { isEnemy: true });
    const { fx } = makeFx({ views: [a, b] });
    const kinds = ['arrow', 'bolt', 'orb', 'bomb', 'lob', 'drone', 'enemy', 'boomerang', 'none'];
    let peakAdd = 0, peakNorm = 0, peakProj = 0;
    const sample = () => {
      let add = 0;
      for (const p of fx.parts) if (p.add) add++;
      peakAdd = Math.max(peakAdd, add);
      peakNorm = Math.max(peakNorm, fx.parts.length - add);
      peakProj = Math.max(peakProj, fx.projs.length);
    };
    for (let f = 0; f < 60 * 12; f++) {
      if (f % 6 === 0) {
        const i = f / 6;
        fx.attack(a, b, kinds[i % kinds.length]);
        fx.damage(b, 120, i % 2 ? 'arts' : 'phys', i % 9 === 8 ? a : null);
      }
      sample();                                      // (particles are freed only at the start of an update)
      fx.update(1 / 60);
      sample();
    }
    assert.ok(peakProj >= 3 && peakAdd > 20, `busy enough (${peakProj} shots, ${peakAdd} particles at once)`);
    assert.equal(fx.addPc.children.length, peakAdd, 'additive particle sprites = the peak alive at once');
    assert.equal(fx.normPc.children.length, peakNorm, 'normal-blend particle sprites = the peak alive at once');
    assert.equal(fx.projLayer.children.length, 3 * peakProj, 'three sprites per projectile record');
    assert.equal(fx.shadowLayer.children.length, peakProj);
    assert.ok(fx.parts.length <= fx.maxParticles);
  });
});

describe('shots', () => {
  test('flight time = distance / sim speed / clock rate; homing on the moving target; one arrival burst', () => {
    FX.setSimProjectileSpeeds(null);
    const a = unit(1, 3, 10), b = unit(2, 9, 10, { isEnemy: true });
    const { fx } = makeFx({ ts: 2, views: [a, b] });
    fx.attack(a, b, 'arrow');
    assert.equal(fx.projs.length, 1);
    const pr = fx.projs[0];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(Math.abs(pr.dur - dist / PROJ.arrow.speed / 2) < 1e-9, `dur ${pr.dur}`);
    assert.equal(pr.trail.texture, fx.tex.tracer);
    assert.equal(liveTex(fx, 'muzzle').length, 1, 'muzzle flash at the shooter');
    b.x = 9.5;                                     // the target moves: the shot follows it
    let t = 0;
    while (!pr.hit && t < 1) { fx.update(DT); t += DT; }
    assert.ok(Math.abs(t - pr.dur) <= DT + 1e-9, `arrived after ${t} (dur ${pr.dur})`);
    assert.equal(pr.tx, 9.5);
    const flares = liveTex(fx, 'flare').length;
    assert.ok(flares >= 1, 'arrival flare');
    run(fx, 0.2);
    assert.equal(fx.projs.length, 0, 'released after its short fade');
    assert.equal(pr.trail.visible || pr.halo.visible || pr.core.visible, false);
  });

  test('every projectile kind flies and lands; shells cast a shadow and explode', () => {
    const a = unit(1, 3, 10), b = unit(2, 7, 11, { isEnemy: true });
    const { fx } = makeFx({ views: [a, b] });
    for (const kind of Object.keys(PROJ)) {
      fx.clear();
      fx.attack(a, b, kind);
      assert.equal(fx.projs.length, 1, kind);
      const pr = fx.projs[0];
      fx.update(DT);
      assert.equal(pr.shadow.visible, PROJ[kind].look === 'shell' || kind === 'boomerang', `${kind} shadow`);
      if (kind === 'bomb' || kind === 'droneBomb') {
        run(fx, pr.dur);
        assert.ok(fx.rings.some((r) => r.sp.texture === fx.tex.shock), 'bomb explosion shockwave');
      }
      run(fx, 3);
      assert.equal(fx.projs.length, 0, `${kind} done`);
    }
  });

  test('chain / beam kinds are beams, melee shots are no projectile', () => {
    const a = unit(1, 3, 10), b = unit(2, 5, 10, { isEnemy: true });
    const { fx } = makeFx({ views: [a, b] });
    fx.attack(a, b, 'chain');
    fx.attack(a, b, 'beam');
    fx.attack(a, b, 'none');
    assert.equal(fx.projs.length, 0);
    assert.equal(fx.beamList.length, 2);
    assert.equal(fx._slashAt, a.id);
  });
});

describe('回环射手 boomerang', () => {
  test('out at the boomerang speed, back to where the thrower is now at the return speed, caught there', () => {
    FX.setSimProjectileSpeeds({ ...SIM.PROJECTILE_SPEEDS, boomerang: 15 }, 3.75);
    const thrower = unit(1, 2, 10), target = unit(2, 8, 10, { isEnemy: true });
    const { fx } = makeFx({ ts: 2, views: [thrower, target] });
    fx.attack(thrower, target, 'boomerang');
    const pr = fx.projs[0];
    const out = Math.hypot(target.x - pr.bx, target.y - pr.by);
    let t = 0;
    while (pr.phase === 0 && t < 3) { fx.update(DT); t += DT; }
    assert.ok(Math.abs(t - out / (15 * 2)) <= 2 * DT, `out leg ${t.toFixed(3)} s ≈ ${(out / 30).toFixed(3)} s`);
    thrower.x = 3;                                  // the thrower moved meanwhile: it flies to where it is now
    const back = Math.hypot(thrower.x - target.x, thrower.y - target.y);
    let t2 = 0;
    while (fx.projs.includes(pr) && t2 < 5) { fx.update(DT); t2 += DT; }
    assert.ok(Math.abs(t2 - back / (3.75 * 2)) <= 2 * DT, `back leg ${t2.toFixed(3)} s ≈ ${(back / 7.5).toFixed(3)} s`);
    assert.ok(Math.abs(pr.bx - 3) < 1e-9, 'caught at the thrower');
    FX.setSimProjectileSpeeds(null);
  });

  test('it spins, and is gone at once when the thrower leaves the field', () => {
    const thrower = unit(1, 2, 10), target = unit(2, 8, 10, { isEnemy: true });
    const { fx } = makeFx({ views: [thrower, target] });
    fx.attack(thrower, target, 'boomerang');
    const pr = fx.projs[0];
    fx.update(DT);
    const r0 = pr.core.rotation;
    fx.update(DT);
    assert.notEqual(pr.core.rotation, r0, 'spinning');
    assert.equal(pr.core.texture, fx.tex.boomerang);
    while (pr.phase === 0) fx.update(DT);
    fx.update(DT);
    thrower.destroyed = true;
    fx.update(DT);
    assert.equal(fx.projs.length, 0, 'dropped on the way back');
    // a thrower already knocked out at the hit gets nothing back
    const t2 = unit(3, 2, 11);
    fx.attack(t2, target, 'boomerang');
    t2.alive = false;
    run(fx, 1);
    assert.equal(fx.projs.length, 0);
  });
});

describe('蕾缪安 S3: lock, bombardShell, bombard', () => {
  const setup = () => {
    const lem = unit(1, 2, 10), e1 = unit(21, 8, 10, { isEnemy: true }), e2 = unit(23, 9, 11.5, { isEnemy: true });
    return { lem, e1, e2, ...makeFx({ ts: 2, views: [lem, e1, e2] }) };
  };

  test('a lock follows its enemy until the bombard of the shell fired at it', () => {
    const { fx, e1 } = setup();
    fx.simFx('lock', 8, 10, { id: 21, src: 1 });
    fx.simFx('lock', 9, 11.5, { id: 23, src: 1 });
    assert.equal(fx.locks.length, 2);
    const [L1, L2] = fx.locks;
    e1.x = 8.4;
    fx.update(DT);
    assert.equal(L1.x, 8.4, 'the reticle follows the locked enemy');
    assert.equal(L1.ring.texture, fx.tex.reticle);
    // the shell fired at e1's spot takes that lock; it flies t game s = t / 2 real s
    fx.simFx('bombardShell', 8.5, 10.1, { id: 1, r: 1.5, t: 0.3, i: 0 });
    const shell = fx.projs.find((p) => p.kind === 'bombardShell');
    assert.ok(shell, 'a shell in the air');
    assert.ok(Math.abs(shell.dur - 0.15) < 1e-9);
    assert.equal(L1.shell, true);
    assert.equal(L2.shell, false);
    assert.ok(fx.rings.filter((r) => r.x === 8.5 && r.y === 10.1).length >= 2, 'warning rings on the spot');
    run(fx, 0.16);
    assert.equal(fx.projs.filter((p) => p.kind === 'bombardShell').length, 0, 'landed');
    assert.ok(L1.out < 0, 'the lock waits for the impact itself');
    fx.simFx('bombard', 8.5, 10.1, { id: 1, r: 1.5 });
    assert.ok(L1.out >= 0, 'released by its bombard');
    assert.ok(L2.out < 0, 'the other lock stays');
    run(fx, 0.3);
    assert.deepEqual(fx.locks, [L2]);
  });

  test("bombard happens at its (x, y), never on the shooter named in `id`; it is a heavy blast", () => {
    const { fx, lem } = setup();
    fx.simFx('bombard', 8, 10, { id: 1, r: 1.5 });
    assert.ok(fx.rings.length >= 2);
    for (const r of fx.rings) assert.deepEqual([r.x, r.y], [8, 10]);
    assert.ok(!fx.rings.some((r) => r.x === lem.x), 'nothing on 蕾缪安');
    assert.ok(liveTex(fx, 'shard').length > 0, 'debris (heavy)');
  });

  test('a bombard with no shell (older sims) releases the nearest lock; locks time out; the S2 snipe ends its aim lock', () => {
    const { fx } = setup();
    fx.simFx('lock', 8, 10, { id: 21, src: 1 });
    fx.simFx('lock', 9, 11.5, { id: 23, src: 1 });
    fx.simFx('bombard', 9, 11.5, { id: 1, r: 1.5 });
    assert.deepEqual(fx.locks.map((L) => L.out >= 0), [false, true]);
    run(fx, 5 / 2 + 0.3);                            // LOCK_T game s at 2×, plus the fade
    assert.equal(fx.locks.length, 0, 'timed out');
    fx.simFx('lock', 8, 10, { id: 21, src: 1 });
    fx.simFx('crit', 8, 10, { id: 23, src: 1 });     // another enemy: stays
    assert.ok(fx.locks[0].out < 0);
    fx.simFx('crit', 8, 10, { id: 21, src: 1 });
    assert.ok(fx.locks[0].out >= 0, 'the snipe on the locked enemy ends the lock');
  });

  test('the shooter knocked out: locks still waiting for a shell go, the one whose shell is in the air stays', () => {
    const { fx, lem } = setup();
    fx.simFx('lock', 8, 10, { id: 21, src: 1 });
    fx.simFx('lock', 9, 11.5, { id: 23, src: 1 });
    fx.simFx('bombardShell', 8, 10, { id: 1, r: 1.5, t: 0.3 });
    const [L1, L2] = fx.locks;
    lem.alive = false;
    fx.update(DT);
    assert.ok(L1.out < 0, 'its shell still lands');
    assert.ok(L2.out >= 0, 'no shell will come');
    fx.simFx('bombard', 8, 10, { id: 1, r: 1.5 });
    assert.ok(L1.out >= 0);
  });

  test('a long S3 (extra ammo, a stun mid-lock): every reticle stays until the bombard of its own shell', () => {
    // 拉特兰 ammo grants / reloads give S3 more than its 5 shots: 20 locks 0.5 game s apart (a 3 game s stun in the
    // middle), then one shell every 0.3 game s landing 0.3 game s later — the first lock waits ≈ 16 game s for its shell
    const enemies = Array.from({ length: 4 }, (_, k) => unit(30 + k, 7 + k, 9 + (k % 2), { isEnemy: true }));
    const lem = unit(1, 2, 10);
    const { fx } = makeFx({ ts: 2, views: [lem, ...enemies] });
    const g = (s) => s / 2;   // game s → real s at 2×
    const locks = [];
    for (let k = 0; k < 20; k++) {
      const e = enemies[k % 4];
      fx.simFx('lock', e.x, e.y, { id: e.id, src: 1 });
      locks.push(fx.locks[fx.locks.length - 1]);
      run(fx, g(k === 9 ? 3.5 : 0.5));
    }
    assert.equal(new Set(locks).size, 20, 'no reticle recycled for another lock');
    for (let k = 0; k < 20; k++) {
      const e = enemies[k % 4];
      fx.simFx('bombardShell', e.x + 0.1, e.y, { id: 1, r: 1.5, t: 0.3, i: k });
      run(fx, g(0.3));
      const live = fx.locks.filter((L) => L.out < 0).length;
      assert.equal(live, 20 - k, `shell ${k}: every lock whose bombard is still to come is up`);
      fx.simFx('bombard', e.x + 0.1, e.y, { id: 1, r: 1.5 });
    }
    run(fx, 0.3);
    assert.equal(fx.locks.length, 0);
  });

  test('a held S3 lock (fx `hold`) waits as long as her skill runs with nothing in range, then LOCK_T after it ends; an unheld lock still times out', () => {
    // 0.2.0 community report: S3 no longer ends by itself with nothing in her range — it waits with its bullets and locks
    const { fx, lem } = setup();
    lem.flags = UF.SKILL;                               // her S3 runs (the snapshot's skill bit)
    fx.simFx('lock', 8, 10, { id: 21, src: 1, hold: 1 });
    fx.simFx('lock', 9, 11.5, { id: 23, src: 1 });      // an S2 aim lock: no hold
    const [held, plain] = fx.locks;
    run(fx, 20 / 2);                                    // 20 game s at 2×, nothing new from her
    assert.ok(fx.locks.includes(held) && held.out < 0, 'the held reticle stays while her skill waits');
    assert.ok(!fx.locks.includes(plain), 'the unheld one timed out after LOCK_T');
    lem.flags = 0;                                      // the skill ended
    run(fx, 4 / 2);
    assert.ok(held.out < 0, 'LOCK_T counts from the skill end');
    run(fx, 1 / 2 + 0.3);
    assert.equal(fx.locks.length, 0, 'gone LOCK_T after the skill ended (no shell came)');
  });

  test('a lock sticks to the enemy named in `id` even when its view is a little off the event spot', () => {
    const { fx, e1 } = setup();
    fx.simFx('lock', 9, 10, { id: 21, src: 1 });   // e1 drawn at (8, 10): a fast walker between snapshots
    assert.equal(fx.locks[0].view, e1);
    e1.x = 7.5;
    fx.update(DT);
    assert.equal(fx.locks[0].x, 7.5);
  });

  test('a lock whose shooter goes quiet still times out (S2 aim at an enemy that died)', () => {
    const { fx } = setup();
    fx.simFx('lock', 8, 10, { id: 21, src: 1 });
    run(fx, 5 / 2 - 0.05);
    assert.equal(fx.locks[0].out, -1);
    run(fx, 0.35);
    assert.equal(fx.locks.length, 0);
  });

  test('a long shell flight climbs out of the shooter first; a short one only falls', () => {
    const { fx, lem } = setup();
    fx.simFx('bombardShell', 8, 10, { id: 1, r: 1.5, t: 1.2 });
    fx.simFx('bombardShell', 9, 11.5, { id: 1, r: 1.5, t: 0.3 });
    const [long, short] = fx.projs;
    assert.ok(long.rise > 0 && short.rise === 0);
    lem.x = 2.5;
    fx.update(DT);
    assert.equal(long.x0, 2.5, 'rising from where she stands');
    run(fx, 1);
    assert.equal(fx.projs.length, 0);
  });
});

describe('fx placement, quality, melee, skill', () => {
  test('_where: on the unit when the fx happens there, else at the event position', () => {
    const caster = unit(1, 2, 10);
    const { fx } = makeFx({ views: [caster] });
    assert.equal(fx._where(2.2, 10.1, { id: 1 }).v, caster, 'on the unit');
    assert.equal(fx._where(NaN, NaN, { id: 1 }).v, caster, 'no position: the unit');
    const far = fx._where(5, 10, { id: 1 });
    assert.deepEqual([far.x, far.y, far.v], [5, 10, null], 'an aoe ahead of its caster');
    fx.simFx('aoe', 6, 11, { id: 1, r: 1 });
    assert.ok(fx.rings.length && fx.rings.every((r) => r.x === 6 && r.y === 11), 'drawn where it happens');
  });

  test("quality 'low' and a heavy load skip the cosmetic particles, not the shots", () => {
    const a = unit(1, 3, 10), b = unit(2, 8, 10, { isEnemy: true });
    for (const [opts, cosmetic] of [[{ quality: 'high' }, true], [{ quality: 'low' }, false], [{ quality: 'high', load: 2 }, false]]) {
      const { fx } = makeFx({ ...opts, views: [a, b] });
      fx.attack(a, b, 'bolt');
      fx.attack(a, b, 'arrow');
      run(fx, 0.05);
      assert.equal(fx.projs.length, 2);
      const extras = liveTex(fx, 'dot').length + liveTex(fx, 'muzzle').length;
      assert.equal(extras > 0, cosmetic, JSON.stringify(opts));
    }
  });

  test('a melee blow draws a slash in the hit colour, swept along the blow', () => {
    const a = unit(1, 4, 10), b = unit(2, 5, 10, { isEnemy: true });
    const { fx } = makeFx({ views: [a, b] });
    fx.attack(a, b, 'none');
    fx.damage(b, 300, 'arts', a);
    const slashes = liveTex(fx, 'slash');
    assert.equal(slashes.length, 2);
    assert.equal(slashes[0].sp.tint, HIT_TINT.arts);
    const pa = cam.project(a.x, a.y, 0.54, {}), pb = cam.project(b.x, b.y, 0.54, {});
    const blow = Math.atan2(pb.y - pa.y, pb.x - pa.x) + Math.PI / 2;
    const d = Math.atan2(Math.sin(slashes[0].sp.rotation - blow), Math.cos(slashes[0].sp.rotation - blow));
    assert.ok(Math.abs(d) <= 0.46, `rotation ${slashes[0].sp.rotation} vs blow ${blow}`);
    assert.equal(fx._slashAt, null);
    fx.damage(b, 300, 'phys', a);                    // a second hit without a new blow: no slash
    assert.equal(liveTex(fx, 'slash').length, 2);
  });

  test('skill activation bursts (pillars, flare, shockwave + hex) and keeps an aura until it ends', () => {
    const v = unit(1, 4, 10);
    const { fx } = makeFx({ views: [v] });
    fx.skill(v, true);
    assert.equal(liveTex(fx, 'pillar').length, 2);
    assert.equal(liveTex(fx, 'flare').length, 1);
    assert.deepEqual(fx.rings.map((r) => texName(fx, r.sp.texture)).sort(), ['hex', 'shock']);
    assert.equal(fx.auras.size, 1);
    run(fx, 1);
    const a = fx.auras.get(1);
    assert.ok(a.sp.alpha > 0.9 && a.hex.alpha > 0.5, 'aura shown');
    fx.skill(v, false);
    run(fx, 0.6);
    assert.equal(fx.auras.size, 0, 'faded out');
  });

  test('user sees an ammo meter drain during Insider attacks without a persistent buff glow', () => {
    // Given a real Insider magazine and a target that survives it.
    const h = makeBattle({
      defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } },
      units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 3 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
      timeLimit: 200, seed: 7,
    });
    const u = h.unit('chess_char_1_01_a');
    assert.ok(h.runUntil(() => u.skill.active, 80));
    const v = new UnitView(fakeViewCtx(fake.P), renderInfo(unitInfo(u)));
    const { fx } = makeFx({ views: [v] });
    const buffer = new SnapshotBuffer({ delay: 0 });
    const sync = () => {
      const snap = h.b.snapshot();
      buffer.push(snap, snap.t);
      v.sync(buffer.sample(snap.t).get(u.id), snap.t);
      v.update(DT, cam, h.b.time);
      fx.update(DT);
    };
    fx.skill(v, true);
    sync();
    assert.equal(u.skill.ammoMax, 14);
    assert.equal(u.skill.ammoLeft, 13, 'activation tick already fired the first round');
    assert.equal(fx.auras.size, 0, 'ammo is displayed below HP, not as a ground aura');
    assert.ok(v.ammoDividers.visible, 'the ammo bar has per-round divisions');
    const fullWidth = v.spBg.width - 2;
    assert.ok(Math.abs(v.spFill.width / fullWidth - 13 / 14) < 1e-9);
    // When actual attacks spend rounds, the displayed fraction changes.
    const rounds = u.skill.ammoLeft;
    assert.ok(h.runUntil(() => u.skill.ammoLeft < rounds && u.skill.active, 10));
    sync();
    assert.ok(Math.abs(v.spFill.width / fullWidth - 12 / 14) < 1e-9, 'one attack removes exactly one round');
    run(fx, 2);
    assert.equal(fx.parts.length, 0, 'no sustained rising buff particles');
    u.skill.addAmmo(14 - u.skill.ammoLeft);
    h.step(1);
    sync();
    assert.equal(v.spFill.width, fullWidth, 'refilling the magazine restores the bar');
    // Then depletion ends the display.
    assert.ok(h.runUntil(() => !u.skill.active, 40));
    sync();
    assert.equal(v.ammoDividers.visible, false, 'after depletion the ordinary SP bar returns');
    fx.skill(v, false);
    run(fx, 0.6);
    assert.equal(fx.auras.size, 0);
    fx.destroy();
    v.destroy();
  });

  test('clear() drops shots, locks, auras and particles', () => {
    const a = unit(1, 3, 10), b = unit(2, 8, 10, { isEnemy: true });
    const { fx } = makeFx({ views: [a, b] });
    fx.attack(a, b, 'boomerang');
    fx.simFx('lock', 8, 10, { id: 2, src: 1 });
    fx.simFx('bombardShell', 8, 10, { id: 1, r: 1.5, t: 0.3 });
    fx.skill(a, true);
    fx.update(DT);
    fx.clear();
    assert.deepEqual([fx.projs.length, fx.locks.length, fx.auras.size, fx.parts.length], [0, 0, 0, 0]);
    fx.update(DT);
    fx.destroy();
  });
});
