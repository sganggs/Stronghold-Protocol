// test/render/hud-readouts.test.js — the HP-bar readouts, client side (R22-HUD; PR #303 and #378 by @IceCodeNew, PR #383
// by @Convey123, folded into one change): render/interp.js carries b.snap `ammo` [[id, left, magazine]], `wolves`
// [[id, left, max]] and `neg` [[id, fill]] beside the unit tuples and samples them from the older snapshot; render/units.js
// draws the ammo skill's segmented yellow bar in place of the SP bar, 伺夜's 狼影 as a row of diamonds and the 我执 pool
// as the red bar over the drained HP bar; an ammo skill has no standing aura (headless fake PIXI, test/render/fakepixi.js).
// 设置「弹药数量」 (PR #552 by @IceCodeNew, off by default) adds the magazine's count under the ammo bar.
// The server side is test/sim/hud-readouts.test.js and test/content/op_hsgma2.test.js.
// Run: node --test test/render/hud-readouts.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { SnapshotBuffer, normalizeSnapshot } from '../../public/js/render/interp.js';
import { renderInfo } from '../../public/js/render/app/info.js';
import { UF } from '../../shared/constants.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { unitInfo } from '../../server/sim/snapshot.js';

let fake, FX, UnitView, COLORS, AMMO_BAR, WOLF_PIPS;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
  ({ UnitView, AMMO_BAR, WOLF_PIPS } = await import('../../public/js/render/units.js'));
  ({ COLORS } = await import('../../public/js/render/style.js'));
});
after(() => { FX?.setSimProjectileSpeeds(null); fake.restore(); });

const cam = () => presetCamera('normal', { width: 1280, height: 720 });
const tuple = (id, hp = 1000, extra = {}) => [id, 5, 10, hp, 1000, extra.sp ?? 0, extra.spMax ?? 0, extra.flags ?? 0, 0];
const view = (info = {}, extra = {}) => new UnitView(fakeViewCtx(fake.P, { cam, ...extra }),
  { id: 1, side: 'ally', kind: 'op', defId: 'char_x', tier: 3, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT', ...info });
const sample = (o = {}) => ({ x: 5, y: 10, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0, vy: 0, ...o });

test('Swire purse snapshots include zero and the selected skill cap; death removes the readout', () => {
  for (const skillIndex of [0, 1, 2]) {
    const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'chess_char_3_04_a', row: 10, col: 4, skillIndex }] });
    h.b.start(); const u = h.unit(1); const cap = u.skill.bb.sp;
    assert.deepEqual(h.b.snapshot().coins, [[u.id, u.mem.coins, cap]]);
    u.mem.coins = 0; assert.deepEqual(h.b.snapshot().coins, [[u.id, 0, cap]]);
    h.b.retreat(u, { reason: 'test' }); assert.equal(h.b.snapshot().coins, undefined);
  }
});

test('coin balance is snapshot-owned: preserves zero, rejects malformed entries and clears when absent', () => {
  const first = normalizeSnapshot({ t: 0, units: [tuple(1)], coins: [[1, 0, 10], [2, 3, 10], [1, -1, 10], [1, 3.5, 10]] });
  assert.deepEqual([...first.coins], [[1, [0, 10]]]);
  const b = new SnapshotBuffer();
  b.push({ t: 0, units: [tuple(1)], coins: [[1, 3, 10]] });
  b.push({ t: 1, units: [tuple(1)] });
  assert.deepEqual(b.sample(0).get(1).coins, [3, 10]);
  assert.equal(b.sample(1).get(1).coins, null);
});

test('the coin HUD shows balance/cap and does not leave a stale label when its snapshot entry disappears', () => {
  const v = view();
  try {
    v.sync(sample({ coins: [0, 10] }), 0); v.update(0.02, cam(), 0);
    assert.equal(v.coinHud?.text.text, '0/10'); assert.equal(v.coinHud.root.visible, true);
    v.sync(sample(), 1); v.update(0.02, cam(), 1); assert.equal(v.coinHud.root.visible, false);
  } finally { v.destroy(); }
});
const frames = (v, n = 2) => { for (let i = 0; i < n; i++) v.update(1 / 60, cam(), i / 60); };
const barWidth = (v) => v.hpBg.width - 2;

describe('interp: ammo / wolves / neg', () => {
  test('sampled from the older snapshot (they step at snapshot boundaries) and cleared by a snapshot without them', () => {
    const buf = new SnapshotBuffer({ delay: 0 });
    buf.push({ t: 1, units: [tuple(1), tuple(2)], ammo: [[1, 13, 14]], wolves: [[2, 2, 3]], neg: [[2, 0.25]] }, 0);
    buf.push({ t: 2, units: [tuple(1), tuple(2)], ammo: [[1, 12, 14]], wolves: [[2, 1, 3]], neg: [[2, 0.5]] }, 0.5);
    buf.push({ t: 3, units: [tuple(1), tuple(2)] }, 1);
    // between the first two snapshots nothing slides: a round, a 狼影 or a share of the pool is not halfway
    const out = buf.sample(1.99);
    assert.deepEqual([out.get(1).ammo, out.get(1).wolves, out.get(1).neg], [[13, 14], null, 0]);
    assert.deepEqual([out.get(2).ammo, out.get(2).wolves, out.get(2).neg], [null, [2, 3], 0.25]);
    buf.sample(2, out);
    assert.deepEqual([out.get(1).ammo, out.get(2).wolves, out.get(2).neg], [[12, 14], [1, 3], 0.5]);
    // a snapshot without the lists takes the readouts off the reused sample objects
    buf.sample(3, out);
    assert.deepEqual([out.get(1).ammo, out.get(2).wolves, out.get(2).neg], [null, null, 0]);
  });

  test('malformed rows are dropped: fractions, negatives, a count above its maximum, a maximum under 1, unknown ids, junk', () => {
    const s = normalizeSnapshot({
      t: 1, units: [tuple(1), tuple(2), tuple(3)],
      ammo: [[1, 13, 14], [2, -1, 14], [2, 2, 1], [2, 1.5, 4], [9, 1, 2], [3, 15, 14], null, 'x', [3, 0, 0]],
      wolves: [[2, 3, 3], [1, 2.5, 3], [1, 4, 3], [3, 1, 0], [9, 1, 3]],
      neg: [[1, 0.4], [2, 0], [3, -1], [3, 'x'], [9, 0.5], [2, 5], null],
    });
    assert.deepEqual([...s.ammo], [[1, [13, 14]]]);
    assert.deepEqual([...s.wolves], [[2, [3, 3]]]);
    assert.deepEqual([...s.neg], [[1, 0.4], [2, 1]], 'a share above 1 is a full pool; 0 / negative / non-numbers are no pool');
    const none = normalizeSnapshot({ t: 1, units: [tuple(1)] });
    assert.deepEqual([none.ammo, none.wolves, none.neg], [null, null, null]);
    assert.equal(none.units.get(1).length, 9, 'the tuples are never widened by the readouts');
  });
});

describe('UnitView: the ammo skill\'s segmented bar', () => {
  test('replaces the SP bar while the magazine runs: a yellow cell per round, the fill is rounds left / magazine, a thin cut at every boundary', () => {
    const v = view();
    v.sync(sample({ flags: UF.SKILL, sp: 22.3, spMax: 24, ammo: [13, 14] }));
    frames(v);
    const bw = barWidth(v);
    assert.equal(v.spBg.visible && v.spFill.visible, true);
    assert.equal(v.spFill.tint, COLORS.ammo);
    assert.ok(Math.abs(v.spFill.width - bw * 13 / 14) < 1e-9, 'rounds left over the magazine, exactly (not the 0.1-rounded SP)');
    const cuts = v.ammoCuts.filter((c) => c.visible);
    assert.equal(cuts.length, 13, 'one cut per boundary of 14 cells');
    const step = bw / 14, x0 = v.spFill.position.x;
    cuts.forEach((c, i) => {
      assert.ok(Math.abs(c.position.x - (x0 + (i + 1) * step - 0.5)) < 1e-9, `cut ${i + 1} on the boundary`);
      assert.equal(c.width, 1);
      assert.equal(c.height, v.spFill.height);
      assert.equal(c.position.y, v.spFill.position.y);
      assert.equal(c.tint, COLORS.hpBack);
    });
    assert.ok(v.spFill.height > v.hpFill.height * 0.6, 'taller than the plain SP bar (the HP bar\'s thickness × AMMO_BAR.height)');
    assert.ok(Math.abs(v.spFill.height - Math.max(2, v.hpFill.height * AMMO_BAR.height)) < 1e-9);
    // a round is spent: the fill loses 1/14 and the cuts stay
    v.sync(sample({ flags: UF.SKILL, sp: 20.6, spMax: 24, ammo: [12, 14] }));
    frames(v);
    assert.ok(Math.abs(v.spFill.width - bw * 12 / 14) < 1e-9);
    assert.equal(v.ammoCuts.filter((c) => c.visible).length, 13);
    // the last round, then the magazine ends: the plain SP bar is back (cyan, no cuts)
    v.sync(sample({ flags: UF.SKILL, ammo: [0, 14], sp: 0, spMax: 24 }));
    frames(v);
    assert.equal(v.spFill.width, 0);
    v.sync(sample({ flags: 0, sp: 6, spMax: 24, ammo: null }));
    frames(v);
    assert.equal(v.ammoCuts.filter((c) => c.visible).length, 0, 'no cuts without a magazine');
    assert.notEqual(v.spFill.tint, COLORS.ammo);
    assert.ok(Math.abs(v.spFill.width - bw * 6 / 24) < 1e-9, 'the SP fraction of the tuple');
    v.destroy();
  });

  test('a magazine needs no SP cost to show; a dense one keeps its exact fill and draws no cuts under AMMO_BAR.minCell px; an enemy never has the bar', () => {
    const v = view();
    v.sync(sample({ flags: UF.SKILL, ammo: [20, 40] }));   // spMax 0: an auto skill with no SP cost
    frames(v);
    const bw = barWidth(v);
    assert.equal(v.spFill.visible, true, 'the bar shows without an SP cost');
    assert.ok(Math.abs(v.spFill.width - bw / 2) < 1e-9);
    const cell = bw / 40;
    assert.equal(v.ammoCuts.filter((c) => c.visible).length, cell >= AMMO_BAR.minCell ? 39 : 0, `${cell.toFixed(2)} px cells`);
    v.sync(sample({ flags: UF.SKILL, ammo: [20, 400] }));
    frames(v);
    assert.equal(v.ammoCuts.filter((c) => c.visible).length, 0, 'under 2 px a cell: no cuts');
    assert.ok(Math.abs(v.spFill.width - bw * 20 / 400) < 1e-9, 'the fill is still exact');
    v.destroy();
    const e = view({ id: 2, side: 'enemy', kind: 'enemy', defId: 'enemy_x' });
    e.sync(sample({ hp: 500, flags: UF.SKILL, ammo: [3, 4] }));
    frames(e);
    assert.equal(e.spFill.visible, false, 'enemies have no SP bar, and so no magazine');
    assert.equal(e.ammoCuts.filter((c) => c.visible).length, 0);
    e.destroy();
  });

  test('the prep view draws no bars, so no cells either', () => {
    const v = view({}, {});
    v.prep = true;
    v.sync(sample({ flags: UF.SKILL, ammo: [5, 14] }));
    frames(v);
    assert.equal(v.spFill.visible, false);
    assert.equal(v.ammoCuts.filter((c) => c.visible).length, 0);
    v.destroy();
  });
});

// 设置「弹药数量」 (PR #552 by @IceCodeNew, DESIGN §31.9): the official HUD has no number under the ammo bar, so the count is an
// option, off by default (the maintainer's decision of 2026-10-13); the settings side is test/ui/ammo-count.test.js
describe('UnitView: the optional ammo count under the bar (设置「弹药数量」)', () => {
  const counting = (on = true) => view({}, { settings: { damageNumbers: true, quality: 'high', ammoCount: on } });
  const coinY = (v) => v.coinHud.root.position.y;

  test('off (the default): nothing is drawn under the magazine, and the rows below stay where they were', () => {
    const v = view();
    const w = counting(false);
    try {
      for (const u of [v, w]) { u.sync(sample({ flags: UF.SKILL, ammo: [13, 14], coins: [3, 10] })); frames(u); }
      assert.equal(v.ammoText, null, 'never built without the setting');
      assert.equal(w.ammoText, null, 'nor with it off');
      assert.equal(v.hud.children.some((c) => c instanceof fake.P.Text && /\d+\/14/.test(c.text)), false);
      const plain = view();
      plain.sync(sample({ coins: [3, 10] }));
      frames(plain);
      assert.equal(coinY(v), coinY(w));
      assert.ok(coinY(v) > coinY(plain), 'the magazine row (thicker than the SP bar) is all that sits above the purse');
      plain.destroy();
    } finally { v.destroy(); w.destroy(); }
  });

  test('on: the exact count through spending, refills and capacity changes, also where the cells are too narrow for cuts', () => {
    const v = counting();
    try {
      for (const [left, max] of [[13, 14], [12, 14], [137, 240], [136, 240], [260, 260], [0, 260]]) {
        v.sync(sample({ flags: UF.SKILL, ammo: [left, max] }));
        frames(v);
        assert.equal(v.ammoText?.text, `${left}/${max}`);
        assert.equal(v.ammoText.visible, true);
        if (max >= 240) assert.equal(v.ammoCuts.filter((c) => c.visible).length, 0, 'a dense magazine draws no cuts, the count still reads');
      }
      const bw = barWidth(v);
      assert.ok(Math.abs(v.ammoText.position.x - (v.spFill.position.x + bw / 2)) < 1e-9, 'centred under the bar');
      assert.ok(v.ammoText.position.y > v.spFill.position.y, 'below the magazine');
      assert.equal(v.ammoText.anchor.x, 0.5);
      assert.equal(v.ammoText.style.fill, COLORS.ammo, 'in the bar\'s yellow');
    } finally { v.destroy(); }
  });

  test('on: hidden when the skill ends, without the snapshot row, in the prep view, after death and for enemies; the rows below make room', () => {
    const v = counting();
    try {
      v.sync(sample({ flags: UF.SKILL, ammo: [5, 14], coins: [3, 10] }));
      frames(v);
      const withCount = coinY(v);
      v.sync(sample({ sp: 6, spMax: 24, coins: [3, 10] }));   // the magazine is spent: the SP bar again
      frames(v);
      assert.equal(v.ammoText.visible, false, 'no stale number after the skill');
      assert.ok(withCount > coinY(v), 'the purse row moved down by the count\'s height while it showed');
      v.sync(sample({ flags: UF.SKILL, ammo: [5, 14] }));
      v.prep = true;
      frames(v);
      assert.equal(v.ammoText.visible, false, 'the prep view draws no bars');
      v.prep = false;
      frames(v);
      assert.equal(v.ammoText.visible, true);
      v.die();
      frames(v);
      assert.equal(v.ammoText.visible, false, 'a dead unit has no bars');
    } finally { v.destroy(); }
    const e = view({ id: 2, side: 'enemy', kind: 'enemy', defId: 'enemy_x' }, { settings: { damageNumbers: true, quality: 'high', ammoCount: true } });
    try {
      e.sync(sample({ hp: 500, flags: UF.SKILL, ammo: [3, 4] }));
      frames(e);
      assert.equal(e.ammoText, null, 'enemies have no magazine, so no count');
    } finally { e.destroy(); }
  });

  test('turning the setting off takes the count away at once (the field view shares its settings object with the units)', () => {
    const v = counting();
    try {
      v.sync(sample({ flags: UF.SKILL, ammo: [9, 14] }));
      frames(v);
      assert.equal(v.ammoText.visible, true);
      v.ctx.settings.ammoCount = false;
      frames(v);
      assert.equal(v.ammoText.visible, false);
      v.ctx.settings.ammoCount = true;
      frames(v);
      assert.equal(v.ammoText.visible, true);
    } finally { v.destroy(); }
  });
});

describe('UnitView: 伺夜\'s 狼影 pips', () => {
  const pack = (extra = {}) => view({ kind: 'token', defId: 'token_10028_vigil_wolf', ...extra });

  test('one diamond per 狼影 the talent allows under the HP bar, the first ones lit for the shadows left', () => {
    const v = pack();
    v.sync(sample({ wolves: [2, 3] }));
    frames(v);
    const r = v._wolfPips;
    assert.equal(r.root.visible, true);
    assert.equal(r.lit.length, 3);
    assert.deepEqual(r.lit.map((d) => d.alpha), [1, 1, WOLF_PIPS.dim]);
    assert.ok(r.lit.every((d) => d.visible && d.tint === COLORS.wolf && Math.abs(d.rotation - Math.PI / 4) < 1e-9), 'pale diamonds');
    assert.ok(r.back.every((d) => d.visible && d.tint === COLORS.hpBack), 'on a dark backing');
    assert.ok(r.lit[0].position.y > v.hpBg.position.y, 'below the HP bar');
    assert.ok(r.lit[0].position.x > v.hpFill.position.x && r.lit[2].position.x < v.hpFill.position.x + barWidth(v), 'inside the bar\'s span');
    assert.ok(r.lit[1].position.x > r.lit[0].position.x && r.lit[2].position.x > r.lit[1].position.x, 'left to right');
    assert.equal(v.spFill.visible, false, 'not an SP bar or a skill indicator');
    // a 狼影 is spent: the last lit one dims; one is gained: it lights again
    v.sync(sample({ wolves: [1, 3] }));
    frames(v);
    assert.deepEqual(r.lit.map((d) => d.alpha), [1, WOLF_PIPS.dim, WOLF_PIPS.dim]);
    v.sync(sample({ wolves: [3, 3] }));
    frames(v);
    assert.deepEqual(r.lit.map((d) => d.alpha), [1, 1, 1]);
    // a smaller maximum hides the surplus diamonds
    v.sync(sample({ wolves: [1, 2] }));
    frames(v);
    assert.equal(r.lit.filter((d) => d.visible).length, 2);
    v.destroy();
  });

  test('hidden without a count (an older snapshot cannot leave stale pips), in the prep view, and for enemies', () => {
    const v = pack();
    v.sync(sample({ wolves: [2, 3] }));
    frames(v);
    assert.equal(v._wolfPips.root.visible, true);
    v.sync(sample({}));
    frames(v);
    assert.equal(v._wolfPips.root.visible, false, 'no row in the snapshot: no pips');
    v.sync(sample({ wolves: [2, 3] }));
    v.prep = true;
    frames(v);
    assert.equal(v._wolfPips.root.visible, false, 'the prep board draws no bars');
    v.destroy();
    const e = view({ id: 2, side: 'enemy', kind: 'enemy', defId: 'enemy_x' });
    e.sync(sample({ hp: 500, wolves: [2, 3] }));
    frames(e);
    assert.equal(e._wolfPips, null, 'only allies carry the row');
    e.destroy();
  });

  test('the element gauge row moves down below the pips (and below the SP bar when there is one)', () => {
    const plain = view();
    plain.sync(sample({ el: 'burn', elFill: 0.4, elUntil: 0, elDur: 0 }));
    frames(plain);
    const v = pack();
    v.sync(sample({ wolves: [2, 3], el: 'burn', elFill: 0.4, elUntil: 0, elDur: 0 }));
    frames(v);
    const pipsBottom = v._wolfPips.back[0].position.y + (v._wolfPips.back[0].width * Math.SQRT2) / 2;
    assert.ok(v._elBar.bg.position.y - v._elBar.bg.height / 2 >= pipsBottom - 1e-6, 'the gauge row starts under the pips');
    assert.ok(v._elBar.bg.position.y > plain._elBar.bg.position.y + 4, 'and so sits lower than without pips');
    plain.destroy();
    v.destroy();
  });
});

describe('UnitView: the 我执 pool as the red bar', () => {
  const ego = (extra = {}) => view({ defId: 'char_1044_hsgma2', tier: 6, ...extra });

  test('drawn over the drained HP bar from its left edge: width = the bar × the pool\'s share, the pool\'s red, gone with the pool', () => {
    const v = ego();
    v.sync(sample({ hp: 1 }));
    frames(v);
    assert.equal(v.negFill.visible, false, 'no pool, no red bar');
    assert.equal(v.negFill.tint, COLORS.hpNeg);
    v.sync(sample({ hp: 1, neg: 0.5 }));
    frames(v);
    assert.equal(v.negFill.visible, true);
    assert.ok(Math.abs(v.negFill.width - barWidth(v) * 0.5) < 1e-9, 'half the pool: half the bar');
    assert.equal(v.negFill.position.x, v.hpFill.position.x, 'from the bar\'s left edge');
    assert.equal(v.negFill.position.y, v.hpFill.position.y);
    assert.equal(v.negFill.height, v.hpFill.height);
    assert.ok(v.hpFill.width < 1, 'the green bar is drained meanwhile');
    v.sync(sample({ hp: 1, neg: 1 }));
    frames(v);
    assert.ok(Math.abs(v.negFill.width - barWidth(v)) < 1e-9, 'a full pool fills the bar');
    v.sync(sample({ hp: 600, neg: 0 }));
    frames(v);
    assert.equal(v.negFill.visible, false, 'she left 我执');
    v.destroy();
  });

  test('not in the prep view, and gone once she falls', () => {
    const p = ego();
    p.prep = true;
    p.sync(sample({ hp: 1, neg: 0.6 }));
    frames(p);
    assert.equal(p.negFill.visible, false);
    p.destroy();
    const v = ego();
    v.sync(sample({ hp: 1, neg: 1 }));
    frames(v);
    assert.equal(v.negFill.visible, true);
    v.die();
    for (let i = 0; i < 300; i++) v.update(1 / 60, cam(), i / 60);
    assert.equal(v.alive, false);
    assert.equal(v.negFill.visible, false, 'no bars for a knocked-out operator');
    v.destroy();
  });
});

describe('an ammo skill has no standing aura', () => {
  const unit = (id, info) => ({ id, x: 3, y: 10, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, isEnemy: false, maxHp: 3000, info, onHit() {} });
  const makeFx = (views) => {
    const ctx = fakeViewCtx(fake.P);
    const map = new Map(views.map((v) => [v.id, v]));
    const c = presetCamera('normal', { width: 1600, height: 900 });
    return new FX.FxSystem({
      P: fake.P, layers: ctx.layers, cam: () => c, heightAt: () => 0, settings: { quality: 'high', damageNumbers: true },
      timeScale: () => 2, loadLevel: () => 0, subProfOf: () => null, view: (id) => map.get(id) || null,
      screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
    });
  };

  test('UnitInfo.ammoSkill: the activation burst plays, the ground glow and hex do not (a plain skill keeps both)', () => {
    const magazine = unit(1, { defId: 'char_x', ammoSkill: true }), plain = unit(2, { defId: 'char_y' });
    const fx = makeFx([magazine, plain]);
    fx.skill(magazine, true);
    assert.ok(fx.parts.length > 0 && fx.rings.length > 0, 'the cast itself is still shown');
    assert.equal(fx.auras.size, 0, 'no glow and hex under a magazine');
    fx.skill(magazine, false);
    fx.skill(plain, true);
    assert.equal(fx.auras.size, 1, 'a plain skill keeps its aura');
    fx.destroy();
  });

  test('the flag travels: unitInfo (ammo skills of allies only) → renderInfo', () => {
    const h = makeBattle({
      defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, timeLimit: 30, seed: 7,
      units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 11, col: 3 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    });
    h.run(0.5);
    assert.equal(renderInfo(unitInfo(h.unit('chess_char_1_01_a'))).ammoSkill, true);
    assert.equal(renderInfo(unitInfo(h.unit('chess_char_1_02_a'))).ammoSkill, undefined);
    assert.equal(renderInfo(unitInfo(h.enemy('enemy_dummy'))).ammoSkill, undefined);
    assert.equal(renderInfo({ id: 1, ammoSkill: 'yes' }).ammoSkill, undefined, 'only a real true counts');
  });
});

describe('the chain: sim → snapshot → SnapshotBuffer → UnitView', () => {
  test('隐现 S2: 14 cells, 13 after the first round, one more gone per attack; no aura; the plain SP bar after the last round', () => {
    const h = makeBattle({
      defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } },
      units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 3 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
      timeLimit: 200, seed: 7,
    });
    const u = h.unit('chess_char_1_01_a');
    assert.ok(h.runUntil(() => u.skill.active, 80));
    const v = new UnitView(fakeViewCtx(fake.P, { cam }), renderInfo(unitInfo(u)));
    const buffer = new SnapshotBuffer({ delay: 0 });
    const show = () => {
      const snap = h.b.snapshot();
      buffer.push(snap, snap.t);
      v.sync(buffer.sample(snap.t).get(u.id), snap.t);
      v.update(1 / 60, cam(), h.b.time);
    };
    show();
    const bw = barWidth(v);
    assert.equal(u.skill.ammoLeft, 13, 'the activation tick already fired the first round');
    assert.ok(Math.abs(v.spFill.width - bw * 13 / 14) < 1e-9);
    assert.equal(v.ammoCuts.filter((c) => c.visible).length, 13);
    const left = u.skill.ammoLeft;
    assert.ok(h.runUntil(() => u.skill.ammoLeft < left && u.skill.active, 10));
    show();
    assert.ok(Math.abs(v.spFill.width - bw * 12 / 14) < 1e-9, 'one attack removes exactly one round');
    assert.ok(h.runUntil(() => !u.skill.active, 60));
    show();
    show();
    assert.equal(v.ammoCuts.filter((c) => c.visible).length, 0, 'the magazine is spent: the plain SP bar is back');
    assert.notEqual(v.spFill.tint, COLORS.ammo);
    v.destroy();
  });

  test('伺夜\'s placed pack: the pips follow 2 → 3 → 2 and are gone when the pack falls', () => {
    const h = makeBattle({
      units: [{ chessId: 'chess_char_3_19_a', row: 12, col: 3, uid: 1 }, { kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 11, col: 5, uid: 2 }],
      timeLimit: 120, defs: { enemies: { enemy_d: enemyRec({ key: 'enemy_d', hp: 1e9, speed: 0, atk: 0 }) } }, enemies: [{ key: 'enemy_d', pos: [1, 1] }],
    });
    h.run(0.2);
    const w = h.b.allyUnits.find((x) => x.defId === 'token_10028_vigil_wolf');
    const v = new UnitView(fakeViewCtx(fake.P, { cam }), renderInfo(unitInfo(w)));
    const buffer = new SnapshotBuffer({ delay: 0 });
    const lit = () => {
      const snap = h.b.snapshot();
      buffer.push(snap, snap.t);
      v.sync(buffer.sample(snap.t).get(w.id), snap.t);
      v.update(1 / 60, cam(), h.b.time);
      return v._wolfPips ? v._wolfPips.lit.filter((d) => d.visible && d.alpha === 1).length : 0;
    };
    assert.equal(lit(), 2);
    h.run(25);
    assert.equal(lit(), 3);
    h.b.dealDamage(null, w, { amount: 1e9, type: 'true' });
    h.step();                                   // (a snapshot of the same game time as the last one would be dropped as a duplicate)
    assert.equal(lit(), 2);
    v.destroy();
  });
});
