// test/render/playtest6-enemies.test.js — user playtest #6, workstream WG, the renderer side (headless fake PIXI):
//   #9  the flying enemy 威龙 was drawn far too large. The official battle prefab scales every enemy's Spine model
//       (Graphic / FaceSwitcher / Spine transforms; SkeletonDataAsset 0.01 everywhere): 0.27 is the standard, 威龙 0.16,
//       妖怪 0.20, 妖怪MKII 0.22 (tools/build-data.mjs MODEL_SCALES → enemies.json `modelScale` = scale / 0.27). The
//       renderer drew every skeleton at one UNIT.modelScale, so 威龙's 35 % wider skeleton came out 1.35× a 妖怪; now it
//       is drawn at its official 0.16 / 0.27 (1.08× a 妖怪, as in the game).
//   #13 a self-feared “萨科塔之翼” flutters around inside its tile: the real sim's positions → the snapshot buffer →
//       UnitView.sync — the model flips left / right as the random flight turns (render/units.js `visFacing`).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { UNIT } from '../../public/js/render/style.js';
import { SnapshotBuffer } from '../../public/js/render/interp.js';
import { makeBattle } from '../helpers/battleHarness.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const A = JSON.parse(fs.readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));

let fake, U;
before(async () => {
  fake = installFakePixi();
  U = await import('../../public/js/render/units.js');
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('normal', { width: 1280, height: 720 });
const store = ({ bounds = true } = {}) => {
  const entry = { skel: '/s/x.skel', atlas: '/s/x.atlas', textures: ['/s/x.png'], anims: { idle: 'Idle' }, animations: { Idle: 1 }, ...(bounds ? { bounds: { x: -300, y: -150, width: 690, height: 390 } } : {}) };
  return {
    picture: () => null, image: async () => null,
    spineEntry: () => entry,
    spine: { acquire: async () => ({ animations: [{ name: 'Idle' }] }), release() {} },
  };
};
function view(info, opts) {
  const ctx = fakeViewCtx(fake.P, { assets: store(opts), cam, lookupDef: (i) => (i.side === 'enemy' ? E[i.defId] || null : null) });
  return new U.UnitView(ctx, { id: 1, side: 'enemy', kind: 'enemy', tier: 1, x: 6, y: 10, maxHp: 1000, motion: 'FLY', ...info });
}
const width = (key) => A.enemies[key].spine.bounds.width;

describe('#9 enemy models at their official prefab scale', () => {
  test('data: 威龙 0.16 / 0.27, 妖怪 0.20 / 0.27, 妖怪MKII 0.22 / 0.27; standard-size enemies carry none', () => {
    assert.equal(E.enemy_1005_yokai_3.modelScale, 0.5926);
    assert.equal(E.enemy_1005_yokai.modelScale, 0.7407);
    assert.equal(E.enemy_1005_yokai_2.modelScale, 0.8148);
    assert.equal(E.enemy_10083_hlbird.modelScale, undefined, '“萨科塔之翼”: 0.27, the standard');
    assert.equal(E.enemy_9013_acstmk.modelScale, undefined, '假想敌：胄: 0.27');
    for (const [k, e] of Object.entries(E)) if (e.modelScale != null) assert.ok(e.modelScale > 0.5 && e.modelScale < 2.3 && e.modelScale !== 1, `${k} ${e.modelScale}`);
    // drawn width 威龙 : 妖怪 — was 1.35 (skeletons alone), officially 689·0.16 : 509·0.20 ≈ 1.08
    const ratio = (width('enemy_1005_yokai_3') * E.enemy_1005_yokai_3.modelScale) / (width('enemy_1005_yokai') * E.enemy_1005_yokai.modelScale);
    assert.ok(Math.abs(ratio - (689.149 * 0.16) / (509 * 0.2)) < 0.01, `ratio ${ratio}`);
    assert.ok(width('enemy_1005_yokai_3') / width('enemy_1005_yokai') > 1.3, 'the skeleton alone is 35 % wider');
  });

  test('UnitView: 威龙\'s skeleton and bar height follow modelScale; operators and standard enemies are unchanged', async () => {
    const drone = view({ defId: 'enemy_1005_yokai_3' });
    const bird = view({ defId: 'enemy_10083_hlbird' });
    const op = view({ side: 'ally', kind: 'chess', defId: 'chess_char_1_01_a', motion: undefined });
    await tick(); await tick();
    for (const v of [drone, bird, op]) { assert.ok(v.spineReady); v.update(1 / 60, cam(), 0); }
    const sc = (v) => Math.abs(v.actor.spine.scale.y) / v.screen.s;
    assert.ok(Math.abs(sc(drone) - UNIT.modelScale * 0.5926) < 1e-9, `威龙 ${sc(drone)}`);
    assert.ok(Math.abs(sc(bird) - UNIT.modelScale) < 1e-9);
    assert.ok(Math.abs(sc(op) - UNIT.modelScale) < 1e-9);
    assert.equal(U.enemyModelScale(E.enemy_1005_yokai_3), 0.5926);
    assert.equal(U.enemyModelScale(null), 1);
    assert.equal(U.enemyModelScale({ modelScale: 'x' }), 1);
    // the HP bar sits on its (smaller) model: 390 units × 1/320 × 0.5926 × 0.92, clamped at 0.55
    assert.ok(Math.abs(drone._headTiles - Math.max(0.55, 390 * UNIT.modelScale * 0.5926 * 0.92)) < 1e-9);
    assert.ok(bird._headTiles > drone._headTiles);
  });

  test('UnitView without setup-pose bounds: the bar height is the chibi headroom × modelScale (bosses keep 2.2)', async () => {
    const sailor = view({ defId: 'enemy_1160_hvyslr', motion: 'WALK' }, { bounds: false });   // 码头水手 0.24 / 0.27
    const bird = view({ defId: 'enemy_10083_hlbird' }, { bounds: false });
    const boss = view({ defId: 'enemy_1160_hvyslr', motion: 'WALK', boss: true }, { bounds: false });
    await tick(); await tick();
    for (const v of [sailor, bird, boss]) { assert.ok(v.spineReady); v.update(1 / 60, cam(), 0); }
    assert.equal(E.enemy_1160_hvyslr.modelScale, 0.8889);
    assert.ok(Math.abs(sailor._headTiles - UNIT.headroom * 0.8889) < 1e-9, `码头水手 ${sailor._headTiles}`);
    assert.equal(bird._headTiles, UNIT.headroom, 'a standard-size model keeps the chibi headroom');
    assert.equal(boss._headTiles, 2.2);
  });
});

// The official's own model quirks, read from its battle prefabs (tools/local-extract/enemy_model_offsets.py, swept over
// all 243 enemies of the mode 2026-10-05): `modelScale` only carries the horizontal product of Graphic / FaceSwitcher /
// Spine, so two enemies are stretched vertically (帝国炮火先兆者 / 帝国炮火中枢先兆者: Graphic scale (0.19, 0.24, 0.24) →
// sy/sx = 1.263) and one is mirrored (木制瑞印: sx −0.4, sy 0.4 → the official draws it flipped). The renderer applies the
// stretch to the skeleton's Y scale (and to the bar height) and flips `flip` for a mirrored model, on top of the usual
// direction flip.
describe('official prefab quirks: vertical stretch and mirrored models', () => {
  test('data: exactly the two 先兆者 stretch, exactly 木制瑞印 mirrors', () => {
    assert.equal(E.enemy_1112_emppnt.modelScaleY, 1.263);
    assert.equal(E.enemy_1112_emppnt_2.modelScaleY, 1.263);
    assert.equal(E.enemy_1196_msfyin.mirrorX, true);
    assert.equal(E.enemy_1112_emppnt.modelScale, 0.7037, 'the horizontal product is unchanged');
    for (const [k, e] of Object.entries(E)) {
      if (e.modelScaleY != null) assert.ok(k === 'enemy_1112_emppnt' || k === 'enemy_1112_emppnt_2', `stretched: ${k}`);
      if (e.mirrorX != null) assert.equal(k, 'enemy_1196_msfyin', `mirrored: ${k}`);
    }
  });

  test('UnitView: the stretched pair is 1.263× taller than wide, its bar sits proportionally higher', async () => {
    const drone = view({ defId: 'enemy_1112_emppnt' });
    const plain = view({ defId: 'enemy_1005_yokai' });
    await tick(); await tick();
    for (const v of [drone, plain]) { assert.ok(v.spineReady); v.update(1 / 60, cam(), 0); }
    const aspect = (v) => Math.abs(v.actor.spine.scale.y) / Math.abs(v.actor.spine.scale.x);
    assert.ok(Math.abs(aspect(drone) - 1.263) < 1e-9, `先兆者 sy/sx ${aspect(drone)}`);
    assert.ok(Math.abs(aspect(plain) - 1) < 1e-9, 'a uniform model stays 1:1');
    assert.equal(U.enemyModelScaleY(E.enemy_1112_emppnt), 1.263);
    assert.equal(U.enemyModelScaleY(E.enemy_1005_yokai), 1);
    assert.equal(U.enemyModelScaleY(null), 1);
    assert.equal(U.enemyModelScaleY({ modelScaleY: 'x' }), 1);
    assert.equal(U.enemyModelScaleY({ modelScaleY: 99 }), 1, 'absurd values fall back to uniform');
    // the HP bar rides the stretched model: 390 units × 1/320 × 0.7037 × 1.263 × 0.92
    assert.ok(Math.abs(drone._headTiles - 390 * UNIT.modelScale * 0.7037 * 1.263 * 0.92) < 1e-9, `bar ${drone._headTiles}`);
    assert.ok(drone._headTiles > plain._headTiles);
  });

  test('UnitView: a mirrored prefab is drawn flipped against an unmirrored model facing the same way', async () => {
    const mirrored = view({ defId: 'enemy_1196_msfyin', motion: 'WALK' });
    const normal = view({ defId: 'enemy_1007_slime', motion: 'WALK' });
    await tick(); await tick();
    for (const v of [mirrored, normal]) { assert.ok(v.spineReady); v.update(1 / 60, cam(), 0); }
    assert.equal(mirrored.mirrorX, true);
    assert.equal(normal.mirrorX, false);
    assert.equal(mirrored.visFacing, normal.visFacing, 'both face the same way');
    assert.equal(Math.sign(mirrored.actor.spine.scale.x), -Math.sign(normal.actor.spine.scale.x), 'the mirrored model flips');
    assert.ok(Math.abs(mirrored.actor.spine.scale.y) > 0);
  });
});

describe('#13 the self-feared “萨科塔之翼” turns left and right on screen', () => {
  test('real sim → snapshot buffer → UnitView: facing flips while it flutters, none while it flies its route', () => {
    const h = makeBattle({ seed: 3, autoFinish: false, timeLimit: 120, units: [] });
    const e = h.spawn('enemy_10083_hlbird', { routeIndex: 2 });   // fly lane (9,10) → (9,2)
    const buf = new SnapshotBuffer({ delay: 0.1, rate: 2 });
    const v = view({ id: e.id, defId: 'enemy_10083_hlbird', x: e.x, y: e.y });
    let now = 0, flipsRoute = 0, flipsFear = 0, last = v.visFacing, fearFrom = null;
    for (let i = 0; i < 30 * 10; i++) {
      h.step();
      if (i === 30 * 3) { h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.6, type: 'true' }); fearFrom = h.b.time; }
      if (i % 3 !== 2) continue;
      now += 3 / 60;                                              // 2× speed: 3 ticks = 1/20 real s
      buf.push(h.b.snapshot(), now);
      buf.update(now);
      const s = buf.sample().get(e.id);
      if (!s) continue;
      v.sync(s, buf.renderT);
      if (v.visFacing !== last) {
        const t = buf.renderT;
        if (fearFrom != null && t > fearFrom + 0.2 && t < fearFrom + 5) flipsFear++;
        else if (fearFrom == null) flipsRoute++;
        last = v.visFacing;
      }
    }
    assert.equal(flipsRoute, 0, 'flying its route (leftwards) it keeps facing left');
    assert.ok(flipsFear >= 2, `flips while fluttering (${flipsFear})`);
  });
});
