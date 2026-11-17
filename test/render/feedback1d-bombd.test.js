// test/render/feedback1d-bombd.test.js — community report D4 after 0.1.0 ("敌方无人机暴鸰的炸弹无法正常投放"), client side:
// 暴鸰's skeleton (enemy_1040_bombd) carries its bomb (slot Bottle) in Idle / Move_Loop / Die and has bomb-less twins
// (Idle_2 / Move_Begin_2 / Move_Loop_2 / Move_End_2 / Die_2: Bottle null) — the official battle prefab switches to them
// after the drop (mode S1, buff bomb_s, replaceAnimPairs Move→Move_2, Idle→Idle_2, Die→Die_2). The view kept the
// bottle under the drone for good and no bomb ever left it. Now: the drop's 'atk' kind 'droneBomb' plays the Attack
// clip once (its OnAttack on the event) and flies a falling bomb (render/style.js PROJ.droneBomb, the sim's
// PROJECTILE_SPEEDS.droneBomb) from the drone to the target; the sim's fx 'phase' { kind: 'bombed' } on the same frame
// switches the view to those clips (render/units.js FORMS) with no fx of its own — they start once the Attack clip is
// over (the official cast's end clip Idle_2), never cutting the drop short.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { ANIM } from '../../shared/constants.js';
import { PROJ } from '../../public/js/render/style.js';
import { PROJECTILE_SPEEDS } from '../../server/sim/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const KEY = 'enemy_1040_bombd';

let fake, UnitView, FORMS, FX;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, FORMS } = await import('../../public/js/render/units.js'));
  FX = await import('../../public/js/render/fx.js');
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('normal', { width: 1280, height: 720 });
function store(id) {
  const entry = assets.enemies[id].spine;
  const names = Object.keys(entry.animations || {});
  return { picture: () => null, image: async () => null, spineEntry: () => entry, spine: { acquire: async () => ({ animations: names.map((name) => ({ name })) }), release() {} } };
}
const sample = (anim = 0) => ({ x: 6, y: 10, hp: 4000, maxHp: 4000, sp: 0, spMax: 0, flags: 0, anim, vx: -0.3 });

describe('D4 暴鸰: the drone lets go of its bomb on screen', () => {
  test('the bomb-less clip set exists in the skeleton the manifest lists', () => {
    const f = FORMS[KEY]?.bombed;
    assert.ok(f, 'FORMS.enemy_1040_bombd.bombed');
    const anims = assets.enemies[KEY].spine.animations;
    for (const name of [f.roles.idle, f.roles.deploy, f.roles.die, f.roles.move.begin, f.roles.move.loop, f.roles.move.end]) assert.ok(name in anims, name);
    assert.ok(!f.change, 'no change clip: the drop itself is the Attack clip (its OnAttack releases the bomb)');
    assert.equal(assets.enemies[KEY].spine.anims.move.loop, 'Move_Loop', 'carrying the bomb until then');
  });

  test('after the drop the drone flies and dies on the *_2 clips; a view built later starts bomb-less', async () => {
    const ctx = fakeViewCtx(fake.P, { assets: store(KEY), cam });
    const v = new UnitView(ctx, { id: 5, side: 'enemy', kind: 'enemy', defId: KEY, spine: KEY, tier: 2, x: 6, y: 10, maxHp: 4000, motion: 'FLY' });
    await tick(); await tick();
    v.sync(sample(ANIM.MOVE), 1);
    assert.equal(v.actor.current, 'Move_Loop', 'the bomb under the drone');
    v.setForm('bombed');
    v.sync(sample(ANIM.MOVE), 2);
    assert.equal(v.actor.current, 'Move_Loop_2', 'no bomb any more');
    v.sync(sample(ANIM.IDLE), 3);
    assert.equal(v.actor.current, 'Idle_2');
    v.die();
    assert.equal(v.actor.current, 'Die_2');
    const w = new UnitView(ctx, { id: 6, side: 'enemy', kind: 'enemy', defId: KEY, spine: KEY, tier: 2, x: 6, y: 10, maxHp: 4000, motion: 'FLY', form: 'bombed' });
    await tick(); await tick();
    w.sync(sample(ANIM.MOVE), 1);
    assert.equal(w.actor.current, 'Move_Loop_2');
  });

  test('the drop plays the Attack clip once at its own speed (its OnAttack on the event); the cast end → Idle_2, then the bomb-less flight', async () => {
    // the client's lookupDef: the drone's data BAT 5 s (it never attacks normally; its attack rhythm used to drive the drop)
    const ctx = fakeViewCtx(fake.P, { assets: store(KEY), cam, lookupDef: () => ({ stats: { bat: 5, aspd: 100 } }) });
    const v = new UnitView(ctx, { id: 5, side: 'enemy', kind: 'enemy', defId: KEY, spine: KEY, tier: 2, x: 6, y: 10, maxHp: 4000, motion: 'FLY' });
    await tick(); await tick();
    const frames = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) v.update(dt, cam(), i * dt); };
    v.sync(sample(ANIM.MOVE), 1);
    assert.equal(v.actor.current, 'Move_Loop');
    // the 'atk' droneBomb is 0.2 game s ahead in the buffer: the clip winds up to its OnAttack (0.267 s)
    assert.ok(v.windUp(0.2, 'droneBomb'), 'wound up');
    assert.equal(v.actor.current, 'Attack');
    frames(12);                                       // 0.2 s: the event is rendered
    v.onAttack({ x: 5, y: 10 }, 1.2, 'droneBomb');
    v.setForm('bombed');
    v.sync(sample(ANIM.IDLE), 1.2);                   // the drone hovers through its cast
    assert.equal(v.actor.current, 'Attack', 'the release frame: the mode change does not cut the drop short');
    frames(40);                                       // 0.667 s (BOMBD_POST_DELAY): the cast ends, 0.067 s of the clip left
    assert.equal(v.actor.current, 'Attack');
    frames(6);
    assert.equal(v.actor.current, 'Idle_2', 'the cast\'s end clip (official _endAnimKey Idle_2), not a 5 s attack rhythm from its BAT');
    v.sync(sample(ANIM.MOVE), 2.2);
    frames(30);
    assert.equal(v.actor.current, 'Move_Loop_2', 'flying on without the bomb');
    assert.equal(v.atkInterval, 5, 'a one-off drop leaves the attack rhythm alone');
  });

  test('render/app.js keeps UnitInfo.form (a field opened after the drop) and hands the atk kind to the view', async () => {
    const src = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
    // applyInfo (formerly addInfo) goes through renderInfo, which keeps the form (feedback1 WD: every enemy form, 转译基底·α's too)
    assert.match(src, /function applyInfo\(u\)\s*\{\s*const info = renderInfo\(u\)/);
    const { renderInfo } = await import('../../public/js/render/app.js');
    assert.equal(renderInfo({ id: 7, kind: 'enemy', side: 'enemy', defId: 'enemy_1040_bombd', form: 'bombed' }).form, 'bombed');
    assert.match(src, /src\.onAttack\?\.\(tgt, now, e\[3\]\)/);
    // the wind-up look-ahead (render/app/windup.js) hands the kind to the view (+ the slot of a strike cast in its tick,
    // §35.48 — its behaviour: test/render/enemy-strike-clip.test.js)
    assert.match(readFileSync(path.join(ROOT, 'public/js/render/app/windup.js'), 'utf8'), /v\.windUp\(t - upcomingT, e\[3\], /);
    assert.match(src, /createWindUpLookahead\(\{ views, woundUp, /);
  });

  test('the drop draws a falling bomb at the sim\'s speed and the mode change draws nothing of its own', () => {
    assert.ok(PROJ.droneBomb, 'PROJ.droneBomb');
    assert.equal(PROJ.droneBomb.speed, PROJECTILE_SPEEDS.droneBomb);
    assert.equal(PROJ.droneBomb.look, 'shell', 'a bomb with a ground shadow, exploding where it lands');
    assert.equal(FX.fxSpec('phase', { kind: 'bombed', id: 5 }).a, 'none');
    assert.notEqual(FX.fxSpec('phase', { kind: 'crawl', id: 5 }).a, 'none', '掠海漂移体 keeps its puff');
  });
});
