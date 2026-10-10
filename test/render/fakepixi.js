// test/render/fakepixi.js — a minimal headless stand-in for PIXI 7 + pixi-spine + a 2D canvas document, enough to
// construct and update render/units.js views and the procedural textures of render/textures.js in Node.
// Records every canvas made (`canvases`) and every BaseTexture created / destroyed, so tests can assert what a
// view allocated. Install before the first render call; `restore()` puts the previous globals back.

const point = (x = 0, y = 0) => ({ x, y, set(a = 0, b = a) { this.x = a; this.y = b; } });

// every CanvasRenderingContext2D method is a no-op; gradients / measurements return plausible objects
function context2d(canvas) {
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'canvas') return canvas;
      if (k === 'measureText') return (s) => ({ width: String(s).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w, h) => { const W = w ?? x?.width ?? 1, H = h ?? x?.height ?? 1; return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }; };
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (typeof k === 'symbol') return undefined;
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

export function installFakePixi() {
  const canvases = [];
  const baseTextures = [];
  const prev = { PIXI: globalThis.PIXI, document: globalThis.document, had: { PIXI: 'PIXI' in globalThis, document: 'document' in globalThis } };

  class DisplayObject {
    constructor() {
      this.children = []; this.parent = null; this.visible = true; this.renderable = true; this.alpha = 1; this.tint = 0xffffff;
      this.position = point(); this.scale = point(1, 1); this.anchor = point(); this.pivot = point(); this.skew = point();
      this.rotation = 0; this.zIndex = 0; this.destroyed = false; this.blendMode = 0; this.sortableChildren = false;
      this._w = null; this._h = null;
    }
    get x() { return this.position.x; } set x(v) { this.position.x = v; }
    get y() { return this.position.y; } set y(v) { this.position.y = v; }
    get width() { return this._w ?? (this.texture ? this.texture.width * Math.abs(this.scale.x) : 0); }
    set width(v) { this._w = v; }
    get height() { return this._h ?? (this.texture ? this.texture.height * Math.abs(this.scale.y) : 0); }
    set height(v) { this._h = v; }
    addChild(...cs) { for (const c of cs) { if (c.parent && c.parent !== this) c.parent.removeChild(c); if (!this.children.includes(c)) this.children.push(c); c.parent = this; } return cs[0]; }
    addChildAt(c) { return this.addChild(c); }
    removeChild(...cs) { for (const c of cs) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; } return cs[0]; }
    removeChildren() { const cs = this.children.slice(); for (const c of cs) this.removeChild(c); return cs; }
    getLocalBounds() { return { x: -50, y: -100, width: 100, height: 100 }; }
    getBounds() { return { x: 0, y: 0, width: 10, height: 10 }; }
    toGlobal(p) { return { x: p.x, y: p.y }; }
    on() { return this; } off() { return this; } once() { return this; }
    destroy() { this.destroyed = true; this.parent?.removeChild(this); }
  }
  class Container extends DisplayObject {}
  class BaseTexture {
    constructor(resource = null) {
      this.resource = resource; this.valid = true; this.destroyed = false; this.width = resource?.width || 1; this.height = resource?.height || 1;
      this._glTextures = {}; baseTextures.push(this);
    }
    static from(src) { return new BaseTexture(src); }
    update() {} setStyle() {} dispose() {} on() { return this; } once() { return this; } off() { return this; }
    destroy() { this.destroyed = true; }
  }
  class Rectangle { constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height }); } }
  class Texture {
    constructor(base, frame) {
      this.baseTexture = base || new BaseTexture();
      this.frame = frame || new Rectangle(0, 0, this.baseTexture.width, this.baseTexture.height);
      this.width = this.frame.width; this.height = this.frame.height; this.destroyed = false; this.orig = this.frame;
    }
    static from(src) { return new Texture(BaseTexture.from(src)); }
    get valid() { return this.baseTexture.valid; }
    update() {} on() { return this; } once() { return this; }
    destroy(base) { this.destroyed = true; if (base) this.baseTexture.destroy(); }
  }
  Texture.EMPTY = new Texture(new BaseTexture({ width: 1, height: 1 }));
  Texture.WHITE = new Texture(new BaseTexture({ width: 16, height: 16 }));
  class Sprite extends Container { constructor(tex) { super(); this.texture = tex || Texture.EMPTY; } }
  class TilingSprite extends Sprite {}
  class Graphics extends Container {
    constructor() { super(); this.geometry = { graphicsData: [] }; }
    clear() { return this; } beginFill() { return this; } endFill() { return this; } lineStyle() { return this; } moveTo() { return this; } lineTo() { return this; }
    drawRect() { return this; } drawCircle() { return this; } drawEllipse() { return this; } drawPolygon() { return this; } drawRoundedRect() { return this; } closePath() { return this; }
    quadraticCurveTo() { return this; } bezierCurveTo() { return this; } arc() { return this; }
  }
  class Text extends Sprite {
    constructor(text = '', style = {}) { super(); this.text = text; this.style = style; this.resolution = 1; this.rasters = 0; this.texture = new Texture(new BaseTexture({ width: 1, height: 1 })); }
    updateText() { this.rasters++; }
  }
  class BitmapText extends Text {}
  class Matrix { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.tx = 0; this.ty = 0; } set() { return this; } translate() { return this; } scale() { return this; } identity() { return this; } }
  class RenderTexture extends Texture { static create({ width = 1, height = 1 } = {}) { return new RenderTexture(new BaseTexture({ width, height })); } resize() {} }
  const track = () => ({ timeScale: 1, trackTime: 0, animationEnd: 1, animationStart: 0, loop: false, mixDuration: 0, animation: { duration: 1, name: '' }, listener: null });
  class Spine extends Container {
    constructor(data) {
      super();
      this.spineData = { findAnimation: () => ({ duration: 1 }), ...data };
      this.autoUpdate = true;
      this.stateData = { defaultMix: 0, setMix() {} };
      this.skeleton = { slots: [], setToSetupPose() {}, setSlotsToSetupPose() {}, updateWorldTransform() {}, findSlot: () => null };
      const tracks = [];
      this.state = {
        tracks, timeScale: 1,
        setAnimation: (i, name, loop) => { const e = { ...track(), loop, animation: { duration: 1, name } }; tracks[i] = e; return e; },
        addAnimation: (i, name, loop) => { const e = { ...track(), loop, animation: { duration: 1, name } }; return e; },
        setEmptyAnimation: () => track(), addEmptyAnimation: () => track(), clearTrack() {}, clearTracks() {}, addListener() {}, update() {}, apply() {},
      };
    }
    update() {}
  }
  const modes = new Proxy({}, { get: () => 0 });
  const P = {
    Container, Sprite, TilingSprite, Graphics, Text, BitmapText, Texture, BaseTexture, Rectangle, Matrix, RenderTexture, DisplayObject,
    ParticleContainer: Container,
    BLEND_MODES: { NORMAL: 0, ADD: 1, MULTIPLY: 2, SCREEN: 3 }, MIPMAP_MODES: modes, SCALE_MODES: modes, WRAP_MODES: modes, ALPHA_MODES: modes,
    BitmapFont: { from() {} },
    utils: { TextureCache: {}, BaseTextureCache: {} },
    spine: { Spine },
  };
  globalThis.PIXI = P;
  globalThis.document = {
    createElement(tag) {
      const c = { tag, width: 300, height: 150, style: {} };
      if (tag === 'canvas') { c.getContext = () => (c._ctx || (c._ctx = context2d(c))); canvases.push(c); }
      return c;
    },
    fonts: undefined,
  };
  return {
    P, canvases, baseTextures,
    restore() {
      if (prev.had.PIXI) globalThis.PIXI = prev.PIXI; else delete globalThis.PIXI;
      if (prev.had.document) globalThis.document = prev.document; else delete globalThis.document;
    },
  };
}

/** Layers + context for a UnitView (render/units.js ViewCtx). */
export function fakeViewCtx(P, extra = {}) {
  const layers = {};
  for (const k of ['ground', 'anim', 'overlay', 'shadow', 'groundFx', 'fxNormal', 'units', 'fxAdd', 'bars', 'text', 'screen']) layers[k] = new P.Container();
  return {
    P, layers, settings: { damageNumbers: true, quality: 'high' }, fx: null,
    heightAt: () => 0, animRate: () => 1, timeScale: () => 1, lookupDef: () => null, crowded: () => false,
    frameNo: () => 0, impostorInterval: () => 0, clipAllowed: () => true, surfaceLayer: () => null,
    ...extra,
  };
}
