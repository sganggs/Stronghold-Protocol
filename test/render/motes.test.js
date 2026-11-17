// test/render/motes.test.js — 魔王（chess_char_4_25_a）T1 过往尘埃 的「微尘」，客户端侧。
//
// 官方把三枚微尘做进她的模型（槽 / 骨 C_Eff_Moire_A + C_Eff_Moire_B / B2 / B3，三枚共用 C_Eff_Moire_B 贴图），但
// **每个动画里这些槽的附件都是 null** —— 官方运行时才贴上去，所以客户端要自己画：贴图取她图集里的 C_Eff_Moire_B，
// 枚数与「S2 的旋转半径扩大」来自 b.snap `motes` [[id, 枚数, 宽半径]]（snapshot.js moteView ← 套件的 unit.moteRing）。
// 这里测纯几何（moteOffsets）、环本身（MoteRing 增删精灵 / 圆周 / 旋转）与两条接线（interp 解析、units.js 挂在她的
// spine 上并在状态消失时拆掉）；服务端侧在 test/sim/hud-readouts.test.js。
// Run: node --test test/render/motes.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { normalizeSnapshot, SnapshotBuffer } from '../../public/js/render/interp.js';
import { MoteRing, moteOffsets, moteOrbitRadius, MOTE_ART, MOTE_MAX, MOTE_ORBIT, MOTE_ORBIT_TILES, MOTE_PERIOD, MOTE_SKELETON_PER_TILE } from '../../public/js/render/motes.js';
import { attachmentTexture } from '../../public/js/render/spine.js';

let fake, UnitView;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
});
after(() => { fake.restore(); });

const cam = () => presetCamera('normal', { width: 1280, height: 720 });
const tuple = (id) => [id, 5, 10, 1000, 1000, 0, 0, 0, 0];
const sample = (o = {}) => ({ x: 5, y: 10, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0, vy: 0, ...o });
const radius = ([x, y]) => Math.round(Math.hypot(x, y));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('微尘的几何（render/motes.js）', () => {
  test('轨道与隐藏五星同一组参数：range_radius 1.15 格、dynamic_spd 30 度/秒（12 秒一圈）、S2 outside_radius 2 格', () => {
    assert.equal(MOTE_PERIOD, 12, '360 度 / 30 度每秒');
    assert.deepEqual({ ...MOTE_ORBIT_TILES }, { normal: 1.15, wide: 2 });
    assert.equal(MOTE_SKELETON_PER_TILE, 320, 'UNIT.modelScale = 1/320');
    assert.deepEqual({ ...MOTE_ORBIT }, { normal: 368, wide: 640 }, '骨架单位 = 格 × 320');
    assert.equal(moteOrbitRadius(0), 368);
    assert.equal(moteOrbitRadius(1), 640);
    // 一秒转 30 度：第 0 枚走过的弦长 = 2 r sin(15°)
    const P = fake.P;
    const ring = new MoteRing({ PIXI: P, getTexture: () => null });
    try {
      ring.setState(1, 0);
      assert.equal(ring.sprites[0].position.y, -MOTE_ART.y);
      const a = [ring.sprites[0].position.x, ring.sprites[0].position.y];
      ring.update(1);
      const b = [ring.sprites[0].position.x, ring.sprites[0].position.y];
      const chord = 2 * MOTE_ORBIT_TILES.normal * MOTE_SKELETON_PER_TILE * Math.sin(Math.PI / 12);
      assert.ok(Math.abs(dist(a, b) - chord) < 1e-6, `一秒的位移 ${dist(a, b).toFixed(2)} ≈ ${chord.toFixed(2)}`);
    } finally { ring.destroy(); }
  });

  test('moteOffsets: 均分一圈、半径按 S2 放大、n = 0 为空、clamp 到 MOTE_MAX', () => {
    for (const n of [1, 2, 3, 6]) {
      const pts = moteOffsets(n, 0, 0);
      assert.equal(pts.length, n);
      for (const p of pts) assert.equal(radius(p), MOTE_ORBIT.normal, `${n} 枚都在普通半径上`);
      if (n > 1) {
        // 相邻两枚的间距 = 正 n 边形的边长
        const side = 2 * MOTE_ORBIT.normal * Math.sin(Math.PI / n);
        for (let i = 0; i < n; i++) {
          const d = dist(pts[i], pts[(i + 1) % n]);
          assert.ok(Math.abs(d - side) < 1e-6, `${n} 枚的第 ${i} 条边 ${d} ≈ ${side}`);
        }
      }
    }
    for (const p of moteOffsets(3, 0, 1)) assert.equal(radius(p), MOTE_ORBIT.wide, 'S2 半径更大');
    assert.deepEqual(moteOffsets(0, 1, 1), []);
    assert.deepEqual(moteOffsets(-2, 0, 0), []);
    assert.equal(moteOffsets(MOTE_MAX + 5, 0, 0).length, MOTE_MAX);
    // 相位推进 = 整圈旋转（第 0 枚跟着相位走）
    const a = moteOffsets(3, 0, 0)[0], b = moteOffsets(3, Math.PI / 2, 0)[0];
    assert.ok(Math.abs(a[0] - MOTE_ORBIT.normal) < 1e-6 && Math.abs(b[1] - MOTE_ORBIT.normal) < 1e-6, '转了 90°');
  });

  test('MoteRing: 按枚数增删精灵、摆在圆周上、随时间旋转、状态清空即收起', () => {
    const P = fake.P;
    const ring = new MoteRing({ PIXI: P, getTexture: () => null });
    try {
      ring.setState(0, 0);
      assert.equal(ring.visible, false);
      assert.equal(ring.sprites.length, 0);

      ring.setState(3, 0);
      assert.equal(ring.visible, true);
      assert.equal(ring.sprites.length, 3, '三枚');
      assert.equal(ring.root.children.length, 3);
      for (const s of ring.sprites) {
        assert.equal(s.width, MOTE_ART.w);
        assert.equal(s.height, MOTE_ART.h);
        assert.equal(Math.round(Math.hypot(s.position.x, s.position.y + MOTE_ART.y)), MOTE_ORBIT.normal);
      }
      // 半圈之后第 0 枚跑到对面
      const before0 = [ring.sprites[0].position.x, ring.sprites[0].position.y];
      for (let i = 0; i < 60; i++) ring.update(MOTE_PERIOD / 2 / 60);
      const after0 = [ring.sprites[0].position.x, ring.sprites[0].position.y];
      assert.ok(dist(before0, after0) > MOTE_ORBIT.normal, '半圈后明显换位');
      assert.equal(ring.sprites.length, 3, '转圈不增删精灵');

      // S2：六枚 + 更大半径
      ring.setState(6, 1);
      assert.equal(ring.sprites.length, 6);
      for (const s of ring.sprites) assert.equal(Math.round(Math.hypot(s.position.x, s.position.y + MOTE_ART.y)), MOTE_ORBIT.wide);

      // 撞掉两枚 → 少两个亮点
      ring.setState(4, 1);
      assert.equal(ring.sprites.length, 4);
      assert.equal(ring.root.children.length, 4);

      // 全部收起
      ring.setState(0, 0);
      assert.equal(ring.visible, false);
      assert.equal(ring.root.children.length, 0, '清空后不残留精灵');
    } finally { ring.destroy(); }
  });

  test('MoteRing: 贴图懒取一次（拿到官方区域后补给已有精灵），拿不到也不炸', () => {
    const P = fake.P;
    let asked = 0;
    const tex = new P.Texture();
    const ring = new MoteRing({ PIXI: P, getTexture: () => { asked++; return asked > 1 ? tex : null; } });
    try {
      ring.setState(2, 0);
      assert.equal(asked, 1, '先问一次');
      assert.equal(ring.sprites[0].texture, P.Texture.EMPTY, '没有贴图时用空纹理');
      ring.setState(3, 0);                       // 第二次 _texture() 拿到
      assert.equal(ring.texture, tex);
      for (const s of ring.sprites) assert.equal(s.texture, tex, '已有精灵也换成官方区域');
    } finally { ring.destroy(); }
  });
});

describe('官方区域贴图（render/spine.js attachmentTexture）', () => {
  const skinOf = (att) => ({ slots: [{ name: 'C_Eff_Moire_B' }], skins: [{ getAttachment: (i, n) => (i === 0 && n === 'C_Eff_Moire_B' ? att : null) }] });

  test('优先用 pixi-spine 备好的区域纹理；没有时按 u/v/w/h 从图集页裁；旋转的区域交回它；找不到即 null', () => {
    const P = fake.P;
    const ready = new P.Texture();
    assert.equal(attachmentTexture(skinOf({ region: { texture: ready } }), 'C_Eff_Moire_B', 'C_Eff_Moire_B', P), ready, '备好的那张直接用');
    const base = new P.BaseTexture({ width: 500, height: 500 });
    const tex = attachmentTexture(skinOf({ region: { u: 0.624, v: 0.494, width: 61, height: 86, rotate: false, page: { baseTexture: base } } }), 'C_Eff_Moire_B', 'C_Eff_Moire_B', P);
    assert.ok(tex, '没有备好的纹理就从页上裁');
    assert.deepEqual([tex.frame.x, tex.frame.y, tex.frame.width, tex.frame.height], [312, 247, 61, 86]);
    assert.equal(attachmentTexture(skinOf({ region: { u: 0, v: 0, width: 1, height: 1, rotate: true, page: { baseTexture: base } } }), 'C_Eff_Moire_B', 'C_Eff_Moire_B', P), null, '旋转区域只认 pixi-spine 自己那张');
    assert.equal(attachmentTexture(skinOf({ region: { texture: ready } }), 'nope', 'C_Eff_Moire_B', P), null, '没有这个槽');
    assert.equal(attachmentTexture(skinOf({ region: { texture: ready } }), 'C_Eff_Moire_B', 'nope', P), null, '没有这个附件');
    assert.equal(attachmentTexture(skinOf({ region: { texture: ready } }), 'C_Eff_Moire_B', 'C_Eff_Moire_B', null), null, '没有 PIXI');
    assert.equal(attachmentTexture(null, 'a', 'b', P), null, '没有骨架数据');
  });
});

describe('微尘的接线（interp + units）', () => {
  test('normalizeSnapshot / sample: 解析 motes，畸形或未列出的 id 丢弃，缺表即清空', () => {
    const first = normalizeSnapshot({ t: 0, units: [tuple(1), tuple(2)], motes: [[1, 3, 0], [2, 6, 1], [3, 3, 0], [1, -1, 0], [1, 2.5, 1]] });
    assert.deepEqual([...first.motes], [[1, { n: 2, wide: 1 }], [2, { n: 6, wide: 1 }]], '只留列出过的 id（3 不在），枚数取下整，宽半径归一');
    const b = new SnapshotBuffer();
    b.push({ t: 0, units: [tuple(1)], motes: [[1, 3, 1]] });
    b.push({ t: 1, units: [tuple(1)] });          // 少一枚的帧没来，但表没了
    assert.equal(b.sample(0).get(1).motes.n, 3);
    assert.equal(b.sample(1).get(1).motes, null, '缺表清空');
    const big = normalizeSnapshot({ t: 0, units: [tuple(1)], motes: [[1, 99, 0]] });
    assert.equal(big.motes.get(1).n, MOTE_MAX, 'clamp 到上限');
  });

  test('UnitView: 有 motes 时把环挂到她的 spine 上并随帧旋转，状态消失后拆掉，没模型就不画', () => {
    const v = new UnitView(fakeViewCtx(fake.P, { cam }), { id: 1, side: 'ally', kind: 'op', defId: 'chess_char_4_25_a', spine: 'char_4134_cetsyr', tier: 4, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT' });
    try {
      // 没有模型（asset 未就绪）：即使有状态也不画（显式清掉 actor，不依赖资产加载的时序）
      v.sync(sample({ motes: { n: 3, wide: 0 } }), 0);
      assert.equal(v.motes.n, 3);
      v._dropActor?.();
      v.actor = null;
      v.spineReady = false;
      v._syncMotes(0.02);
      assert.equal(v.moteRing, null, '没有 spine 就不建环');
      // 每帧都驱动：在一张没有模型的普通视图上证明 update() 会调 _syncMotes（不牵扯整套 actor 更新）
      const plain = new UnitView(fakeViewCtx(fake.P, { cam }), { id: 9, side: 'ally', kind: 'op', defId: 'char_x', tier: 3, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT' });
      try {
        let driven = 0, elapsed = 0;
        plain.ctx.animRate = () => 2;
        const orig = plain._syncMotes.bind(plain);
        plain._syncMotes = (dt) => { driven++; elapsed += dt; return orig(dt); };
        plain.update(0.02, cam(), 1);
        assert.equal(driven, 1, 'update() 每帧调 _syncMotes');
        assert.equal(elapsed, 0.04, 'orbit follows the game clock at double speed');
        plain.ctx.animRate = () => 0;
        plain.update(0.02, cam(), 2);
        assert.equal(elapsed, 0.04, 'paused clock does not advance the orbit');
      } finally { plain.destroy(); }
      // 装上模型（spine + 官方区域都就位）
      const spine = new fake.P.Container();
      let asked = 0;
      v.actor = { spine, destroy: () => {}, effectTexture: (slot, name) => { asked++; assert.equal(slot, MOTE_ART.slot); assert.equal(name, MOTE_ART.name); return new fake.P.Texture(); } };
      v.spineReady = true;
      v.motes = { n: 3, wide: 0 };                 // sync() 给的字段（桩 actor 撑不起完整 sync，这里直接给）
      v._syncMotes(0.02);
      assert.ok(v.moteRing, '建起来了');
      assert.equal(v.moteRing.n, 3);
      assert.ok(spine.children.includes(v.moteRing.root), '挂在她的 spine 里（跟着缩放 / 朝向 / alpha）');
      assert.equal(asked, 1, '官方区域只取一次');
      const p0 = [v.moteRing.sprites[0].position.x, v.moteRing.sprites[0].position.y];
      for (let i = 0; i < 20; i++) v._syncMotes(MOTE_PERIOD / 4 / 20);
      assert.ok(dist(p0, [v.moteRing.sprites[0].position.x, v.moteRing.sprites[0].position.y]) > 10, '随帧旋转');
      // S2 的宽半径
      v.motes = { n: 6, wide: 1 };
      v._syncMotes(0.02);
      assert.equal(v.moteRing.n, 6);
      assert.equal(v.moteRing.sprites.length, 6);
      // 状态消失（她倒了 / 微尘全被撞掉）
      v.motes = null;
      v._syncMotes(0.02);
      assert.equal(v.moteRing, null, '拆掉了');
      assert.equal(spine.children.length, 0, '不残留');
      // 别的单位没有这条表：完全不受影响
      const other = new UnitView(fakeViewCtx(fake.P, { cam }), { id: 2, side: 'ally', kind: 'op', defId: 'char_x', tier: 3, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT' });
      try {
        other.sync(sample(), 0);
        other._syncMotes(0.02);
        assert.equal(other.motes, null, '别的单位没有这条表');
        assert.equal(other.moteRing, null, '也就没有环');
      } finally { other.destroy(); }
    } finally { v.destroy(); }
  });
});
