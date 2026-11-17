// render/motes.js — 魔王（chess_char_4_25_a）T1 过往尘埃 的「微尘」：持续绕着她转的那几枚。
//
// 官方把微尘做进了她的模型：四个槽 / 骨 `C_Eff_Moire_A` + `C_Eff_Moire_B` / `B2` / `B3`（三枚共用 `C_Eff_Moire_B`
// 贴图，121×172 骨架单位），但**所有动画里这些槽的附件都是 `null`**（Idle 与各技能的 Begin / Loop / End 全一样）——
// 官方是运行时由战斗逻辑把附件贴上去并驱动位置的，只播动画不会出现，所以我们的客户端要自己画。
//
// 取官方的哪一半：贴图（区域、尺寸）直接取她 spine 图集里的 `C_Eff_Moire_B`；位置与旋转由这里驱动 ——
// 枚数与「S2 的旋转半径扩大」来自模拟端：
//
//   b.snap `motes`  [[id, 枚数, 宽半径]]   （snapshot.js moteView ← 套件 chess_char_4_25-cetsyr.js 的 unit.moteRing）
//   MoteRing                              按枚数均分一圈、随时间旋转；S2 半径更大
//
// 轨道参数与隐藏五星魔王（`server/sim/content/kits/ops/chess_char_5_09-cetsyr.js` 的 T1 实现）同一组：
// `range_radius` = 1.15 格、`dynamic_spd` = 30 度/秒（维护者 2026-10-15 的评审：这不是「单位不明」，那颗五星已经
// 按这组值在模拟轨道），所以这里也取每秒 30 度、半径 1.15 格。四星的环**只是装饰**：四星的碰撞是 `range_radius`
// 整圈判定，不对应每一粒的实际位置（能不能撞到、重生都由 server/sim 决定）；隐藏五星的环这次先不挂（它不发布
// `motes`，客户端也不会给它画环）。S2 的「旋转半径扩大」取 S2 黑板 `outside_radius`（2 格，模拟端用它判定撞敌人的范围；
// 环画到 2 格是 [ASSUMED] —— 官方数据里只有这一个数值可用）。
//
// 一枚微尘被友方（或 S2 的敌方）撞掉时，模拟端会立刻少报一枚 —— 圈上就少一个亮点，6 秒后重生时再补回来；
// S3 期间模拟端不再消耗（`keep`），所以圈上一直是三枚。这套只影响画面：模拟端的微尘逻辑（命中、重生、×1.5 特性）
// 一如既往由 `server/sim` 决定。

/** 最多画几枚（模拟端的自身上限：平时 3 枚，S2 立刻补到 6 枚）。 */
export const MOTE_MAX = 9;
/**
 * 一圈用多少秒：官方 `talents.bb.dynamic_spd` = 30 度/秒（隐藏五星的同一组参数，维护者评审确认），360 / 30 = 12 秒。
 * S2 黑板里的 `dynamic_spd: 0.9` 含义不明，这里不采用（[ASSUMED]）。
 */
export const MOTE_PERIOD = 12;
/** 一格 = 多少骨架单位（`render/style.js` UNIT.modelScale = 1 / 320，干员的模型就按它画）。 */
export const MOTE_SKELETON_PER_TILE = 320;
/** 环绕半径（格）：T1 的 `range_radius` 与 S2 的 `outside_radius`。 */
export const MOTE_ORBIT_TILES = Object.freeze({ normal: 1.15, wide: 2 });
/** 环绕半径（骨架单位：环挂在她的 spine 容器里，坐标与模型同一套）。 */
export const MOTE_ORBIT = Object.freeze({ normal: MOTE_ORBIT_TILES.normal * MOTE_SKELETON_PER_TILE, wide: MOTE_ORBIT_TILES.wide * MOTE_SKELETON_PER_TILE });
/** 官方微尘的区域（`C_Eff_Moire_B`）与它在她身上的高度（骨架单位，y 从脚下算起）。 */
export const MOTE_ART = Object.freeze({ slot: 'C_Eff_Moire_B', name: 'C_Eff_Moire_B', w: 121, h: 172, y: 168 });

/** Orbit radius of one mote (skeleton units). */
export const moteOrbitRadius = (wide) => (wide ? MOTE_ORBIT.wide : MOTE_ORBIT.normal);

/**
 * Offsets of the motes of one frame, relative to the unit's feet origin (skeleton units, y up): `n` motes share the
 * circle evenly, the whole ring turned by `phase` radians.
 * @param {number} n mote count
 * @param {number} phase radians
 * @param {number|boolean} wide S2's wider radius
 * @returns {Array<[number, number]>}
 */
export function moteOffsets(n, phase = 0, wide = 0) {
  const k = Math.max(0, Math.min(MOTE_MAX, Math.floor(Number(n) || 0)));
  const r = moteOrbitRadius(wide);
  const out = [];
  for (let i = 0; i < k; i++) {
    const a = phase + (i * Math.PI * 2) / k;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/**
 * The ring of motes around one unit: `n` sprites of the official `C_Eff_Moire_B` region, evenly spread and turning.
 * Lives inside the unit's spine container (so it inherits the model's scale, facing and alpha) and is driven from the
 * snapshot's `motes` entry; without a texture it still draws the ring (an empty sprite shows nothing, the units.js
 * caller can pass a procedural fallback instead).
 */
export class MoteRing {
  /**
   * @param {{ PIXI: any, getTexture?: (() => any)|null, fallback?: boolean }} opts `getTexture` = the official region,
   *   asked for lazily (once) — null keeps whatever the sprites already have
   */
  constructor({ PIXI, getTexture = null, fallback = false } = {}) {
    this.P = PIXI;
    this.getTexture = getTexture;
    this.fallback = !!fallback;
    this.root = new PIXI.Container();
    this.root.label = 'motes';
    this.sprites = [];
    this.texture = null;
    this.n = 0;
    this.wide = 0;
    this.phase = 0;
  }

  /** Mote count / radius mode of this frame (`n` = 0 hides the ring). */
  setState(n, wide = 0) {
    const want = Math.max(0, Math.min(MOTE_MAX, Math.floor(Number(n) || 0)));
    this.wide = wide ? 1 : 0;
    if (want !== this.n) { this.n = want; this._resize(); }
    this._place();
  }

  /** Advance the orbit (`dt` seconds) — the caller only draws, the phase lives here. */
  update(dt) {
    if (!(this.n > 0) || !(dt > 0)) return;
    const turn = (Math.PI * 2) / MOTE_PERIOD;
    this.phase = (this.phase + dt * turn) % (Math.PI * 2);
    this._place();
  }

  /** The official texture, asked for once; the empty texture keeps a sprite valid when there is none. */
  _texture() {
    if (this.texture) return this.texture;
    const t = this.getTexture ? this.getTexture() : null;
    if (t) {
      this.texture = t;
      for (const s of this.sprites) s.texture = t;
    }
    return this.texture || this.P.Texture.EMPTY;
  }

  _resize() {
    this._texture();
    while (this.sprites.length < this.n) {
      const s = new this.P.Sprite(this.texture || this.P.Texture.EMPTY);
      if (!this.fallback) { s.width = MOTE_ART.w; s.height = MOTE_ART.h; }
      this.sprites.push(s);
      this.root.addChild(s);
    }
    while (this.sprites.length > this.n) {
      const s = this.sprites.pop();
      try { this.root.removeChild(s); } catch { /* ignore */ }
      try { s.destroy?.(); } catch { /* ignore */ }
    }
  }

  _place() {
    const pts = moteOffsets(this.n, this.phase, this.wide);
    for (let i = 0; i < this.n; i++) {
      const s = this.sprites[i];
      if (!s) continue;
      s.position.set(pts[i][0], -(pts[i][1] + MOTE_ART.y)); // Spine display coordinates have y down.
      s.rotation = 0;                    // the motes stay upright while the ring turns
      s.alpha = 1;
    }
  }

  get visible() { return this.n > 0; }

  destroy() {
    for (const s of this.sprites) { try { s.destroy?.(); } catch { /* ignore */ } }
    this.sprites = [];
    this.n = 0;
    try { this.root.destroy?.({ children: true }); } catch { /* ignore */ }
  }
}
