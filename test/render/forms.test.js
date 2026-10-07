// test/render/forms.test.js — user playtest #5 item 1, client side: 掠海漂移体 drops from 近地悬浮 to 爬行模式 for good
// when stunned / frozen / put to sleep (sim content/enemies.js kitSyufo, fx 'phase' { id, kind: 'crawl' }); from then on
// melee operators block and hit it, so its model must stop hovering: render/units.js FORMS switches the view to the
// skeleton's crawl clips (*_02) after its 'Change' clip (render/spine.js SpineActor.setForm), also for a view built
// after the change (render/app.js keeps the mode on the unit info). Headless fake PIXI (test/render/fakepixi.js).
// Player reports after 0.1.0 (#5, #8): 转译基底·α changes on its 2 s A_Die_B / _C / _D clip into the 寻仇者 B_*, 幽灵 C_* or
// 特战术师 D_* set (it used to stay on A_Idle / A_Move and die on B_Die — "加载变身动画然后就没了"); a knocked-out 逐火 plays
// 'Die' (its 1 s 重生) and walks as the ember on Idle_2 / Move_2, dying on Die_2, and 'Revive' — timed from the 'ember'
// fx's `dur` to end as it stands up — brings the warrior back (sim fx 'ember' / 'revive' { form: 'husk' | 'revived' });
// 假想敌：再生's 傀儡 the same with A_Die / B_* / B_Revive; the leaders' 重生 close on their last clip as the 重生 ends.
// A view built mid-battle gets the current form from UnitInfo `form` through render/app.js renderInfo (enterBattle).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { UF, ANIM } from '../../shared/constants.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const SYUFO = 'enemy_2025_syufo';

let fake, UnitView, FORMS, renderInfo;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, FORMS } = await import('../../public/js/render/units.js'));
  ({ renderInfo } = await import('../../public/js/render/app.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('normal', { width: 1280, height: 720 });

/** Asset store with the real manifest entry of the skeleton and its animation names. */
function store(id) {
  const entry = assets.enemies[id].spine;
  const names = Object.keys(entry.animations || {});
  return {
    picture: () => null,
    image: async () => null,
    spineEntry: () => entry,
    spine: { acquire: async () => ({ animations: names.map((name) => ({ name })) }), release() {} },
  };
}

async function syufo(info = {}) {
  const ctx = fakeViewCtx(fake.P, { assets: store(SYUFO), cam });
  const v = new UnitView(ctx, { id: 7, side: 'enemy', kind: 'enemy', defId: SYUFO, spine: SYUFO, tier: 1, x: 8, y: 9, maxHp: 1000, facing: -1, ...info });
  await tick(); await tick();
  assert.ok(v.actor, 'Spine model built');
  return v;
}
const clip = (v) => v.actor.current;
const sample = (flags = 0, anim = 0) => ({ x: 8, y: 9, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags, anim, vx: 0 });
const frames = (v, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) v.update(dt, cam(), i * dt); };

describe('掠海漂移体 爬行模式 (FORMS)', () => {
  test('the crawl set exists in the skeleton the manifest lists', () => {
    const f = FORMS[SYUFO].crawl;
    const anims = assets.enemies[SYUFO].spine.animations;
    for (const name of [f.change, f.roles.idle, f.roles.die, f.roles.move.loop, f.roles.attack.loop]) assert.ok(name in anims, name);
    assert.equal(assets.enemies[SYUFO].spine.anims.idle, 'Idle_01', 'the manifest keeps the hover set as the default');
  });

  test('hovering: the hover clips; on the change: \'Change\' once, then the crawl clips (idle, move, attack, die)', async () => {
    const v = await syufo();
    v.sync(sample(), 1);
    assert.equal(clip(v), 'Idle_01');
    v.setForm('crawl');
    assert.equal(clip(v), 'Change', 'the transition first');
    frames(v, 50);                                   // Change is 0.667 s
    assert.equal(clip(v), 'Idle_02', 'crawling idle');
    v.sync(sample(0, ANIM.MOVE), 2);
    assert.equal(clip(v), 'Move_02');
    v.onAttack?.(null, 2.1);
    assert.equal(clip(v), 'Attack_02');
    v.die();
    assert.equal(clip(v), 'Die_02');
  });

  test('stunned when it drops (the usual case): the change plays out, then the stun holds, then it crawls', async () => {
    const v = await syufo();
    v.sync(sample(UF.STUNNED), 1);
    assert.equal(v.actor.mode, 'stun');
    v.setForm('crawl');
    assert.equal(clip(v), 'Change');
    frames(v, 10);
    v.sync(sample(UF.STUNNED), 1.2);                 // still stunned: the change is not cut short
    assert.equal(v.actor.mode, 'change');
    frames(v, 40);
    assert.equal(v.actor.mode, 'stun', 'then the stun holds (its pose frozen)');
    v.sync(sample(0), 3);
    assert.equal(clip(v), 'Idle_02', 'the stun over: crawling');
  });

  test('a view built after the change (culled, rejoined) starts on the crawl set without replaying \'Change\'', async () => {
    const v = await syufo({ form: 'crawl' });
    assert.equal(v.form, 'crawl');
    v.sync(sample(), 1);
    assert.equal(clip(v), 'Idle_02');
    const w = await syufo({ form: 'crawl' });
    w.die();
    assert.equal(clip(w), 'Die_02');
  });

  test('modes without a clip set change nothing; the same mode twice is a no-op', async () => {
    const v = await syufo();
    v.setForm('grounded');
    assert.equal(clip(v), 'Idle_01');
    v.setForm('crawl');
    frames(v, 50);
    v.setForm('crawl');
    assert.equal(clip(v), 'Idle_02', 'no second Change');
    const ctx = fakeViewCtx(fake.P, { assets: store('enemy_10045_parrot'), cam });
    const p = new UnitView(ctx, { id: 8, side: 'enemy', kind: 'enemy', defId: 'enemy_10045_parrot', spine: 'enemy_10045_parrot', tier: 1, x: 8, y: 9, maxHp: 1000 });
    await tick(); await tick();
    p.setForm('grounded');
    p.setForm('float');
    assert.equal(clip(p), 'Idle_A', '吉兆飞鳞 keeps its own clips (its 晕眩模式 is the Stun clip)');
  });
});

/** A real-manifest enemy view (any skeleton). */
async function enemy(id, info = {}) {
  const ctx = fakeViewCtx(fake.P, { assets: store(id), cam });
  const v = new UnitView(ctx, { id: 9, side: 'enemy', kind: 'enemy', defId: id, spine: id, tier: 2, x: 8, y: 9, maxHp: 1000, facing: -1, ...info });
  await tick(); await tick();
  assert.ok(v.actor, 'Spine model built');
  return v;
}

describe('转译基底·α forms (user report after 0.1.0, #5)', () => {
  const TR = 'enemy_10081_mpplai';
  test('every clip of the three forms exists in the skeleton; the change clips last the official 2 s; the manifest keeps the original form', () => {
    const anims = assets.enemies[TR].spine.animations;
    for (const [kind, f] of Object.entries(FORMS[TR])) {
      for (const name of [f.change, f.roles.idle, f.roles.die, f.roles.move.loop]) assert.ok(name in anims, `${kind}: ${name}`);
      assert.equal(anims[f.change], 2, `${kind}: ${f.change}`);
    }
    assert.equal(FORMS[TR].translator_youling.roles.attack, null, '幽灵 never attacks');
    assert.equal(assets.enemies[TR].spine.anims.idle, 'A_Idle');
    assert.equal(assets.enemies[TR].spine.anims.move.loop, 'A_Move');
  });

  for (const [kind, set, attack] of [['translator_fuchou', 'B', 'B_Attack'], ['translator_shushi', 'D', 'D_Attack'], ['translator_youling', 'C', null]]) {
    test(`${kind}: the original form walks on A_*, the change clip plays out (2 s, moving or not), then the ${set}_* set`, async () => {
      const v = await enemy(TR);
      v.sync(sample(0, ANIM.MOVE), 1);
      assert.equal(clip(v), 'A_Move');
      v.setForm(kind);
      assert.equal(clip(v), FORMS[TR][kind].change);
      frames(v, 60);
      v.sync(sample(0, ANIM.MOVE), 2);
      assert.equal(clip(v), FORMS[TR][kind].change, 'not cut short');
      frames(v, 70);
      assert.equal(clip(v), `${set}_Move`);
      v.sync(sample(0, ANIM.IDLE), 3);
      assert.equal(clip(v), `${set}_Idle`);
      v.onAttack(null, 3.2);
      assert.equal(clip(v), attack ?? `${set}_Idle`, attack ? 'its attack clip' : 'no attack clip');
      v.die();
      assert.equal(clip(v), `${set}_Die`);
    });
  }

  test('a view built after the change starts on the form\'s clips', async () => {
    const v = await enemy(TR, { form: 'translator_shushi' });
    v.sync(sample(), 1);
    assert.equal(clip(v), 'D_Idle');
  });
});

describe('逐火 embers and the 再生 puppet (user report after 0.1.0, #8)', () => {
  for (const id of ['enemy_1288_duskls', 'enemy_1288_duskls_2', 'enemy_1292_duskld']) {
    test(`${id}: knocked out ⇒ 'Die' once, the ember on Idle_2 / Move_2 / Die_2; 'Revive' ends as it stands up, then the warrior's clips`, async () => {
      const anims = assets.enemies[id].spine.animations;
      for (const name of ['Die', 'Idle_2', 'Move_2', 'Die_2', 'Revive']) assert.ok(name in anims, name);
      const v = await enemy(id);
      v.sync(sample(0, ANIM.MOVE), 1);
      assert.equal(clip(v), 'Move');
      const dur = 4;                                   // the 'ember' fx: 1 s 重生 + the husk (10 s officially)
      v.setForm('husk', { dur });
      assert.equal(clip(v), 'Die', 'the knock-out (its 1 s 重生)');
      frames(v, 65);
      assert.equal(clip(v), 'Move_2', 'the ember walks');
      v.sync(sample(UF.STEALTH, ANIM.IDLE), 2);
      assert.equal(clip(v), 'Idle_2');
      frames(v, Math.round((dur - anims.Revive - 65 / 60) * 60) + 3);
      assert.equal(clip(v), 'Revive', 'the stand-up clip starts so that it ends with the husk');
      frames(v, Math.round(anims.Revive * 60) - 6);
      v.setForm('revived');                            // the sim's 'revive' fx
      assert.equal(clip(v), 'Revive', 'plays out, not restarted');
      frames(v, 10);
      assert.equal(clip(v), 'Idle', 'the warrior again');
      v.onAttack(null, 6);
      assert.equal(clip(v), 'Attack', 'it attacks at once');
      v.setForm('husk', { dur });
      frames(v, 65);
      v.die();
      assert.equal(clip(v), 'Die_2', 'the ember dies on its own clip');
      frames(v, 300);
      assert.equal(clip(v), 'Die_2', 'no stand-up clip after its death');
    });
  }

  test('假想敌：再生: A_Die, the 傀儡 on B_Idle / B_Move / B_Die; B_Revive back to the A_* clips', async () => {
    const v = await enemy('enemy_9010_acpupp');
    v.setForm('husk', { dur: 3 });
    assert.equal(clip(v), 'A_Die');
    frames(v, 65);
    assert.equal(clip(v), 'B_Idle');
    v.sync(sample(0, ANIM.MOVE), 2);
    assert.equal(clip(v), 'B_Move');
    frames(v, 60);
    assert.equal(clip(v), 'B_Revive', 'its last second');
    frames(v, 57);
    v.setForm('revived');
    frames(v, 6);
    assert.equal(clip(v), 'A_Move');
  });

  test('beaten in its last second (the stand-up clip already playing, still a husk in the sim): the ember dies on Die_2, 再生\'s 傀儡 on B_Die — the warrior\'s / A_* death clip only after the revive fx', async () => {
    for (const [id, end, die, die0] of [['enemy_1288_duskls', 'Revive', 'Die_2', 'Die'], ['enemy_9010_acpupp', 'B_Revive', 'B_Die', 'A_Die']]) {
      const anims = assets.enemies[id].spine.animations;
      const v = await enemy(id);
      v.setForm('husk', { dur: 4 });
      frames(v, Math.round((4 - anims[end]) * 60) + 6);
      assert.equal(clip(v), end, `${id}: the closing clip plays`);
      v.die();
      assert.equal(clip(v), die, `${id}: the husk's death clip (review of WD)`);
      const w = await enemy(id);
      w.setForm('husk', { dur: 4 });
      frames(w, 4 * 60 + 6);
      w.setForm('revived');
      frames(w, 6);
      w.die();
      assert.equal(clip(w), die0, `${id}: stood up, it dies on its first form's clip`);
    }
  });

  test('a view built mid-husk (UnitInfo form, no timing) shows the husk; the revival lands in the manifest clips', async () => {
    const v = await enemy('enemy_1288_duskls', { form: 'husk' });
    v.sync(sample(UF.STEALTH, ANIM.MOVE), 1);
    assert.equal(clip(v), 'Move_2');
    v.setForm('revived');
    assert.equal(clip(v), 'Move', 'no stand-up clip without the timing');
  });
});

describe('the leaders\' 重生 and 守墓石像 (audit of the knock-out forms after report #5)', () => {
  const REBIRTH = {
    enemy_1525_blkswb: ['Revive1', 'Revive2', 'Revive3', 'B_Idle', 'B_Die'],
    enemy_1535_wlfmster: ['A_revive_1', 'A_revive_2', 'A_revive_3', 'B_Idle', 'B_Die'],
    enemy_1539_reid: ['Revive_Begin', 'Revive_Loop', 'Revive_End', 'Idle', 'Die'],
  };
  for (const [id, [begin, hold, end, idle2, die2]] of Object.entries(REBIRTH)) {
    test(`${id}: knock-out ⇒ ${begin}, ${hold} held through the 重生's stun, ${end}, then ${idle2}; dies on ${die2}`, async () => {
      const anims = assets.enemies[id].spine.animations;
      for (const name of [begin, hold, end, idle2, die2]) assert.ok(name in anims, name);
      const v = await enemy(id);
      v.sync(sample(UF.STUNNED, ANIM.STUN), 1);
      const dur = 6;                                   // the 'telegraph' fx's dur (Reborn.duration)
      v.setForm('reborn', { dur });
      assert.equal(clip(v), begin);
      frames(v, Math.ceil(anims[begin] * 60) + 5);
      assert.equal(clip(v), hold, 'held (its stun role) while the sim keeps it stunned');
      const at = Math.ceil(anims[begin] * 60) + 5;
      frames(v, Math.round((dur - anims[end]) * 60) - at + 3);
      assert.equal(clip(v), end, 'the closing clip starts so that it ends with the 重生');
      frames(v, Math.round(anims[end] * 60) - 6);
      v.sync(sample(0, ANIM.IDLE), dur + 1);           // the sim's 'revive' fx: the 重生 is over
      v.setForm('form2');
      frames(v, 6);
      assert.equal(clip(v), idle2, 'the second form at once');
      v.onAttack(null, dur + 1.2);
      assert.notEqual(clip(v), idle2, 'its first attack is drawn, not swallowed by a change clip');
      v.die();
      assert.equal(clip(v), die2);
    });
  }

  test('enemy_1516_jakill 杰斯顿: C1_Die is its 4 s 重生, then the killer form C2_*', async () => {
    const v = await enemy('enemy_1516_jakill');
    v.setForm('reborn');
    assert.equal(clip(v), 'C1_Die');
    frames(v, 245);
    v.setForm('form2');
    v.sync(sample(0, ANIM.MOVE), 5);
    assert.equal(clip(v), 'C2_Move');
    v.onAttack(null, 5.5);
    assert.equal(clip(v), 'C2_Attack');
  });

  test('enemy_1172_dugago 守墓石像: the statue on Sleep, the flyer on *_2', async () => {
    const v = await enemy('enemy_1172_dugago');
    v.setForm('stone');
    v.sync(sample(), 1);
    assert.equal(clip(v), 'Sleep');
    v.setForm('fly');
    v.sync(sample(UF.FLYING, ANIM.MOVE), 2);
    assert.equal(clip(v), 'Move_2');
    v.die();
    assert.equal(clip(v), 'Die_2');
  });

  test('a kind without a clip set of that skeleton (an arts barrier, a broken charge) keeps the current form', async () => {
    const v = await enemy('enemy_10081_mpplai');
    v.setForm('translator_fuchou');
    frames(v, 130);
    v.setForm('artsBarrier');
    assert.equal(v.form, 'translator_fuchou');
    v.sync(sample(), 3);
    assert.equal(clip(v), 'B_Idle');
  });
});

test('a view built mid-battle from the real sim\'s fieldMeta (fx dropped by a silent catch-up), through render/app.js renderInfo — what enterBattle(meta) hands the views — starts in the current form: the changed 转译基底·α on D_Idle / C_Idle, the 逐火 ember on Idle_2, 锏 after its 重生 on B_Idle, 掠海漂移体 crawling', async () => {
  const mage = chessRec({ id: 't_mage', profession: 'CASTER', stats: { atk: 50, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: null });
  const wall = chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  const quiet = () => ({ trait: { noAttack: true } });
  const h = makeBattle({
    stageId: 'act2autochess_m01', content: 'full', seed: 7, autoFinish: false, timeLimit: 600, modeId: 'mode_multi_hard', round: 3,
    defs: { chess: { t_mage: mage, t_wall: wall } }, units: [{ chessId: 't_mage', row: 12, col: 2 }, { chessId: 't_wall', row: 9, col: 4 }],
    kits: { t_mage: quiet, t_wall: quiet },
  });
  h.step();
  const still = { mods: { speedMul: 0 } };
  const tr = h.b.spawnEnemy('enemy_10081_mpplai', { pos: [10, 8], ...still });
  const ghost = h.b.spawnEnemy('enemy_10081_mpplai', { pos: [9, 4.4], ...still });   // walks into the wall: blocked ⇒ 幽灵
  const ember = h.b.spawnEnemy('enemy_1288_duskls', { pos: [11, 8], ...still });
  const mace = h.b.spawnEnemy('enemy_1525_blkswb', { pos: [12, 8], ...still });
  const drift = h.b.spawnEnemy(SYUFO, { pos: [11, 10], ...still });
  const m = h.unit('t_mage');
  for (let i = 0; i < 4; i++) h.b.dealDamage(m, tr, { amount: 1, type: 'arts' });   // the 4th arts hit ⇒ 特战术师
  h.b.kill(ember, m);
  h.b.kill(mace, m);
  h.b.applyStatus(drift, 'stun', { duration: 1, source: m });                       // 掠海漂移体 drops to 爬行模式
  const until = h.b.time + 6;
  while (h.b.time < until) { h.b.step(); h.b.drainEvents(); }
  const meta = h.b.fieldMeta();
  const view = async (u) => {
    const info = renderInfo(meta.units.find((x) => x.id === u.id));
    const ctx = fakeViewCtx(fake.P, { assets: store(info.spine), cam });
    const v = new UnitView(ctx, info);
    await tick(); await tick();
    v.sync(sample(), 1);
    return v;
  };
  assert.equal(clip(await view(tr)), 'D_Idle', '特战术师, not the A model');
  assert.equal(clip(await view(ghost)), 'C_Idle', '幽灵 (blocked first), not the A model');
  const e = await view(ember);
  assert.equal(clip(e), 'Idle_2', 'the ember, not the warrior');
  e.die();
  assert.equal(clip(e), 'Die_2', 'and it dies on the ember\'s clip');
  assert.equal(clip(await view(mace)), 'B_Idle', '锏\'s second form');
  assert.equal(clip(await view(drift)), 'Idle_02', '掠海漂移体 crawls (DESIGN §19.1: a reload used to hover)');
});

test('render/app.js renderInfo keeps UnitInfo `form` (it used to drop it: views built from fieldMeta drew the first form)', () => {
  assert.equal(renderInfo({ id: 3, kind: 'enemy', side: 'enemy', defId: 'enemy_1288_duskls', form: 'husk' }).form, 'husk');
  assert.equal(renderInfo({ id: 3, kind: 'enemy', side: 'enemy', defId: 'enemy_1288_duskls' }).form, undefined);
  assert.equal(renderInfo({ id: 3, form: 7 }).form, undefined, 'only a string');
  assert.equal(renderInfo({ kind: 'enemy' }), null, 'no id: no info');
});

test('render/app.js hands the `form` of a sim fx (shared/protocol.js fxForm) with the fx to the view and keeps the mode on the unit info', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
  assert.match(src, /const form = fxForm\(e\);[\s\S]{0,250}inf\.form = form[\s\S]{0,250}setForm\?\.\(form, x\)/);
  // a form fx handed out late (render/interp.js takeEvents `late`) switches the model with its closing clip shortened by
  // the lateness and without replaying its telegraph
  assert.match(src, /const x = late > 0 \? \{ \.\.\.e\[4\], late, \.\.\.\(Number\(e\[4\]\.dur\) > 0 \? \{ dur: Math\.max\(0, Number\(e\[4\]\.dur\) - late\) \} : \{\}\) \} : e\[4\];/);
  // …and UnitView.setForm skips a change clip that would already have ended
  assert.match(readFileSync(path.join(ROOT, 'public/js/render/units.js'), 'utf8'), /!\(late > 0 && late >= \(this\.actor\.dur\?\.\(f\.change\) \?\? Infinity\)\)/);
  assert.match(src, /if \(!\(late > 0\)\) fx\.simFx\(/);
  assert.match(src, /interp\.takeEvents\(renderT, EVS, renderT - 1\.5, LATE\);/);
});

// 重生 animated by the skeleton's own Revive clip: 巨大的丑东西 (kitUglyThing: KO ⇒ 10 s 重生 ⇒ the fleeing 大祭司) and
// 自在 (kitXi: KO ⇒ 5 s 重生 ⇒ the same model, stronger). Their manifests carried no form set at all, so their 重生
// played no clip (docs/research/13 §8).
test('“巨大的丑东西” / “自在”: the 重生 plays the skeleton’s Revive clip, then the second form', () => {
  const mc = FORMS.enemy_1512_mcmstr;
  assert.equal(mc.reborn.change, 'Revive', 'the 8.67 s Revive clip is the 重生 (reborn.duration 10)');
  assert.equal(mc.reborn.next, 'form2');
  assert.equal(mc.form2.roles.idle, 'Idle_2');
  assert.equal(mc.form2.roles.move.loop, 'Move_2');
  assert.equal(mc.form2.roles.attack, null, 'the 大祭司 never attacks');
  const xi = FORMS.enemy_1517_xi;
  assert.equal(xi.reborn.change, 'Revive_01', 'the 5.33 s Revive_01 is the 重生 (reborn.duration 5)');
  assert.deepEqual(xi.form2.roles, {}, 'the same model, only reborn.atk stronger');
});

// Every clip a form set names must exist in that model's manifest: a typo here is a silently missing animation.
test('every clip FORMS names exists in its model’s manifest', () => {
  const clipsOf = (v, out = new Set()) => {
    if (typeof v === 'string') { if (v) out.add(v); return out; }
    if (Array.isArray(v)) { for (const x of v) clipsOf(x, out); return out; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'via' && k !== 'index' && k !== 'next') clipsOf(x, out);
    return out;
  };
  const entries = (id) => {
    const out = [];
    const e = assets.enemies?.[id]?.spine; if (e) out.push(e);
    const t = assets.tokens?.[id]?.spine; if (t) out.push(t);
    const c = assets.chars?.[id]?.spine; if (c) out.push(...[c.front, c.back].filter(Boolean));
    return out;
  };
  const bad = [];
  let checked = 0;
  for (const [id, forms] of Object.entries(FORMS)) {
    const es = entries(id);
    if (!es.length) continue;                      // a spine id whose manifest entry is under another name
    checked++;
    for (const [form, spec] of Object.entries(forms)) {
      for (const clip of clipsOf(spec)) {
        if (!es.some((e) => e.animations && Object.hasOwn(e.animations, clip))) bad.push(`${id}.${form}: ${clip}`);
      }
    }
  }
  assert.ok(checked > 10, `the table was walked (${checked} models)`);
  assert.deepEqual(bad, [], 'clips named by a form set but missing from the manifest');
});
