























import { ensurePixi } from '../../render/app/pixi.js';

export const SPINE_PATHS = Object.freeze({
  holder: 'panel_shop_main/fold_mask_spine/closure_spine_holder',
  foldMask: 'panel_shop_main/fold_mask_spine',
  cleaner: 'panel_shop_main/fold_mask_spine/stencil_cleaner',
});


export const HOLDER = Object.freeze({ width: 180, height: 160, scale: 0.45, pivot: [0.5, 0.5] });


export const UNAVAIL_SPINE_COLOR = 0x808080;

export const AVAIL_SPINE_COLOR = 0xffffff;


export const IDLE = Object.freeze({ animation: 'Idle', fallback: 'Default', timeScale: 1 });


export const SPINE_MODES = Object.freeze(['compose', 'overlay', 'off']);
export const DEFAULT_SPINE_MODE = 'compose';


export function spineModeOf(raw) {
  if (raw === '0' || raw === 'off' || raw === 'none') return 'off';
  if (raw === 'overlay') return 'overlay';
  if (raw === 'compose') return 'compose';
  return DEFAULT_SPINE_MODE;
}

let runtimePromise = null;

/**
 * The product's single PIXI/pixi-spine loader (`render/app/pixi.js`): it loads /vendor once, installs the
 * no-eval uniform setters (CSP `script-src 'self'`) and is shared with the battle renderer, so no second
 * PIXI instance is created here.
 * @returns {Promise<any>}
 */
export function ensureSpineRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const PIXI = await ensurePixi();
      if (!PIXI || !PIXI.spine || !PIXI.spine.Spine) throw new Error('pixi-spine did not register on PIXI');
      return PIXI;
    })();
    runtimePromise.catch(() => { runtimePromise = null; });
  }
  return runtimePromise;
}


/**
 * Skeleton data through the product's own spine loaders: an installed official pack's character.spine
 * (URLs, loaded by assets.loadSpineData — the same loader the battle HUD uses) or an imported pack's
 * blobs (themeSpine.loadSpineFromBlobs). No second atlas/parser implementation here.
 */
async function loadCharacterData(PIXI, character) {
  const spine = character && character.spine;
  if (!spine) throw new Error('theme character has no spine');
  if (spine.blobs) {
    const { loadSpineFromBlobs } = await import('../../themeSpine.js');
    if (!loadSpineFromBlobs) throw new Error('theme spine blob loader missing');
    return loadSpineFromBlobs(spine.blobs, PIXI);
  }
  const { loadSpineData, validSpine } = await import('../../assets.js');
  const entry = { ...spine, anims: spine.anims || (character.anims || { idle: IDLE.animation }) };
  if (!validSpine(entry)) throw new Error('invalid theme spine entry');
  return loadSpineData(entry);
}

export class ShopSpineView {
  constructor({ scene, host, params = null, mode = null, character = null, hidden = false } = {}) {
    this.scene = scene;
    this.host = host || document.getElementById('host');
    this.shopCanvas = scene && scene.canvas;
    this.params = params || new URLSearchParams('');
    this.character = character;
    this.hidden = !!hidden;
    this.mode = mode ? spineModeOf(mode) : (params ? spineModeOf(params.get('spine')) : DEFAULT_SPINE_MODE);
    this.dead = false;
    this.app = null;
    this.actor = null;
    this.container = null;
    this.maskGraphics = null;
    this.canvas = null;

    this.quadCache = null;
    this.surfaceKey = '';
    this.buffer = null;
    this.animation = null;
    this.animations = [];
    this.spineVersion = null;
    this.skeletonBounds = null;
    this.paused = false;
    this.frozenTime = null;
    this.lastNow = 0;
    this.frameCount = 0;
    this.lastKey = '';
    this.renderMs = 0;
    this.renderSamples = [];

    this.debug = {
      loaded: false,
      mode: this.mode,
      animation: null,
      bounds: null,
      box: null,
      mask: null,
      scale: null,
      tint: null,
      paused: false,
      time: 0,
      frames: 0,
      version: null,
      animations: [],
      texture: null,
      insertOrder: null,
      uploadMs: null,
      uploaded: null,
      uploadSkipped: null,
      renderMs: null,
      error: null,
    };

    this.debug.seek = (t) => this.seek(t);
    this.debug.pause = (p) => this.pause(p);
    this.debug.setHidden = (h) => this.setHidden(h);
  }


  async start() {
    if (this.started) return this;
    this.started = true;
    try {
      if (this.mode === 'off') {
        this.hidden = true;
        this.debug.error = 'spine mode off';
        return this;
      }
      if (!this.character || !this.character.spine) {
        this.debug.error = 'no spine character (theme pack character.spine)';
        this.hidden = true;
        return this;
      }
      const PIXI = await ensureSpineRuntime();
      if (this.dead) return this;
      const data = await loadCharacterData(PIXI, this.character);
      const animations = (Array.isArray(data.animations) ? data.animations : []).map((a) => a && a.name).filter(Boolean);
      const version = (data.skeleton && data.skeleton.spine) || data.version || null;
      if (this.dead) return this;
      this.PIXI = PIXI;
      this.spineData = data;
      this.spineVersion = version;
      this.animations = animations;
      // An imported pack's skeleton is built from its bytes (themeSpine.js), so every atlas page texture is this
      // view's own and must be freed on destroy. An official pack's pages come through PIXI.Assets and are
      // shared with the funds-card character and the battle HUD (assets.js unloadSpineData owns their lifetime),
      // so they are never destroyed here.
      this.ownedTextures = this.character && this.character.spine && this.character.spine.blobs
        ? atlasBaseTextures(data)
        : [];

      this.skeletonBounds = {
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        width: Number(data.width) || 0,
        height: Number(data.height) || 0,
      };
      this.animation = animations.includes(IDLE.animation)
        ? IDLE.animation
        : (animations.includes(IDLE.fallback) ? IDLE.fallback : animations[0] || null);
      this.actor = new PIXI.spine.Spine(data);
      this.actor.autoUpdate = false;
      this.playIdle();




      this.envelope = this.sampleIdleEnvelope();
      this.mount();
      this.debug.loaded = true;
      this.debug.animation = this.animation;
      this.debug.version = this.spineVersion;
      this.debug.animations = this.animations.slice();
      this.updateBoundsDebug();
      this.tick(performance.now(), true);
    } catch (err) {
      this.debug.error = String((err && err.message) || err);
    }
    return this;
  }

  playIdle() {
    if (!this.actor || !this.animation) return;
    try { this.actor.state.setAnimation(0, this.animation, true); } catch {  }
  }


  center() {
    const geo = this.geometry();
    const holder = geo && geo.holder;
    if (holder) return { x: holder.x + holder.w * 0.5, y: holder.y + holder.h * 0.5 };
    return { x: 0, y: 0 };
  }


  sampleIdleEnvelope() {
    const actor = this.actor;
    if (!actor) return null;
    const anim = this.spineData && this.spineData.findAnimation ? this.spineData.findAnimation(this.animation) : null;
    const duration = anim && Number(anim.duration) > 0 ? Number(anim.duration) : 2;
    const steps = Math.min(120, Math.max(12, Math.ceil(duration * 30)));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const acc = (b) => {
      if (!b) return;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    };
    try {
      actor.state.clearTracks();
      actor.state.setAnimation(0, this.animation, true);
      for (let i = 0; i < steps; i += 1) {
        actor.state.update(duration * (i / steps));
        actor.update(0);
        acc(actor.getLocalBounds());
      }
    } catch {  }
    if (!Number.isFinite(minX)) {
      try { acc(actor.getLocalBounds()); } catch {  }
    }
    try {
      actor.state.clearTracks();
      actor.state.setAnimation(0, this.animation, true);
      actor.state.update(0);
      actor.update(0);
    } catch {  }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, duration, steps };
  }


  envelopeBox(margin = 6) {
    const env = this.envelope;
    if (!env) return null;
    const scale = this.holderScale();
    const c = this.center();
    const size = (this.scene && this.scene.size) || [1920, 372];
    let x = c.x + env.x * scale - margin;
    let y = c.y + env.y * scale - margin;
    let w = env.w * scale + margin * 2;
    let h = env.h * scale + margin * 2;
    const maxX = Number(size[0]) || 1920;
    const maxY = Number(size[1]) || 372;
    const clipX = Math.max(0, x);
    const clipY = Math.max(0, y);
    const clipX1 = Math.min(maxX, x + w);
    const clipY1 = Math.min(maxY, y + h);
    x = clipX;
    y = clipY;
    w = Math.max(1, clipX1 - clipX);
    h = Math.max(1, clipY1 - clipY);
    return { x, y, w, h };
  }


  growToFit(boundsInPrefab, margin = 6) {
    const box = this.envBox;
    if (!box || !boundsInPrefab) return false;
    const needX = Math.min(box.x, boundsInPrefab.x - margin);
    const needY = Math.min(box.y, boundsInPrefab.y - margin);
    const needX1 = Math.max(box.x + box.w, boundsInPrefab.x + boundsInPrefab.w + margin);
    const needY1 = Math.max(box.y + box.h, boundsInPrefab.y + boundsInPrefab.h + margin);
    if (needX > box.x - 0.5 && needY > box.y - 0.5 && needX1 < box.x + box.w + 0.5 && needY1 < box.y + box.h + 0.5) return false;
    const size = (this.scene && this.scene.size) || [1920, 372];
    const x = Math.max(0, needX);
    const y = Math.max(0, needY);
    this.envBox = {
      x,
      y,
      w: Math.max(1, Math.min(Number(size[0]) || 1920, needX1) - x),
      h: Math.max(1, Math.min(Number(size[1]) || 372, needY1) - y),
    };
    this.surfaceKey = '';
    this.needsStagePaint = true;
    return true;
  }


  mount() {
    if (!this.shopCanvas) throw new Error('no shop canvas');
    if (this.mode === 'compose') return this.mountOffscreen();
    return this.mountOverlay();
  }


  mountOffscreen() {
    const PIXI = this.PIXI;
    this.envBox = this.envelopeBox() || this.fallbackBox();
    const bw = 1;
    const bh = 1;
    const canvas = document.createElement('canvas');
    canvas.id = 'shop-spine-offscreen';
    canvas.width = bw;
    canvas.height = bh;
    this.canvas = canvas;
    this.buffer = { w: bw, h: bh };
    this.surfaceKey = '';
    this.app = new PIXI.Application({
      view: canvas,
      width: bw,
      height: bh,
      backgroundAlpha: 0,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      autoStart: false,
      sharedTicker: false,
    });

    this.container = new PIXI.Container();
    this.container.addChild(this.actor);
    this.maskGraphics = new PIXI.Graphics();
    this.app.stage.addChild(this.container);
    this.app.stage.addChild(this.maskGraphics);
    this.container.mask = this.maskGraphics;
    this.debug.texture = { w: bw, h: bh, source: 'canvas' };
    this.debug.envelopeBox = this.envBox ? { ...this.envBox } : null;
  }


  mountOverlay() {
    const PIXI = this.PIXI;
    const shop = this.shopCanvas;
    if (!shop || !this.host) throw new Error('no shop canvas/host');
    const canvas = document.createElement('canvas');
    canvas.id = 'shop-spine';
    canvas.setAttribute('aria-hidden', 'true');
    const size = surfaceOf(shop, this.host);
    const dpr = Math.max(1, Number(this.scene.dpr) || 1);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    Object.assign(canvas.style, {
      position: 'absolute',
      left: `${size.left}px`,
      top: `${size.top}px`,
      width: `${size.width}px`,
      height: `${size.height}px`,
      pointerEvents: 'none',
      zIndex: '1',
    });
    this.host.append(canvas);
    this.canvas = canvas;
    this.app = new PIXI.Application({
      view: canvas,
      width: size.width,
      height: size.height,
      backgroundAlpha: 0,
      antialias: false,
      resolution: dpr,
      autoDensity: true,
      autoStart: false,
      sharedTicker: false,
    });


    applyBox(canvas, size);
    this.container = new PIXI.Container();
    this.container.addChild(this.actor);
    this.maskGraphics = new PIXI.Graphics();
    this.app.stage.addChild(this.container);
    this.app.stage.addChild(this.maskGraphics);
    this.container.mask = this.maskGraphics;
  }


  fallbackBox() {
    const size = (this.scene && this.scene.size) || [1920, 372];
    return { x: 0, y: 0, w: Number(size[0]) || 1920, h: Number(size[1]) || 372 };
  }


  syncSurface() {
    const shop = this.shopCanvas;
    const canvas = this.canvas;
    if (!shop || !canvas || !this.app) return false;
    const dpr = Math.max(1, Number(this.scene.dpr) || 1);
    const size = surfaceOf(shop, this.host);
    const key = `${size.width}x${size.height}@${dpr}:${size.left},${size.top}`;
    if (key === this.lastKey) return false;
    this.lastKey = key;
    this.app.renderer.resolution = dpr;
    this.app.renderer.resize(size.width, size.height);
    applyBox(canvas, size);
    return true;
  }


  holderScale() {
    const node = this.scene && this.scene.index && this.scene.index.byPath
      ? this.scene.index.byPath.get(SPINE_PATHS.holder)
      : null;
    const scale = node && Array.isArray(node.scale) ? Number(node.scale[0]) : NaN;
    return Number.isFinite(scale) && scale > 0 ? scale : HOLDER.scale;
  }


  geometry() {
    const boxes = (this.scene && this.scene.frame && this.scene.frame.boxes) || null;
    if (!boxes) return null;
    const holder = boxes.get(SPINE_PATHS.holder) || null;
    const cleaner = boxes.get(SPINE_PATHS.cleaner) || null;
    const foldMask = boxes.get(SPINE_PATHS.foldMask) || null;
    return {
      holder,
      cleaner,
      foldMask,
      unit: Number(this.scene.unitCss) || 1,
      unitPx: this.unitPx(),
    };
  }


  unitPx() {
    const renderer = this.scene && this.scene.renderer;
    const unit = renderer && typeof renderer.unit === 'function' ? Number(renderer.unit()) : NaN;
    if (Number.isFinite(unit) && unit > 0) return unit;
    return (Number(this.scene && this.scene.unitCss) || 1) * (Math.max(1, Number(this.scene && this.scene.dpr) || 1));
  }


  desiredTint() {
    const model = this.scene && this.scene.model;
    const available = model ? model.avalid !== false : true;
    return available ? AVAIL_SPINE_COLOR : UNAVAIL_SPINE_COLOR;
  }


  tick(now = performance.now(), force = false) {
    if (this.dead || !this.app || !this.actor) return false;
    const geo = this.geometry();
    if (!geo || !geo.holder) return false;
    const { holder } = geo;

    const visible = !this.hidden
      && holder.shown !== false
      && Number(holder.alpha) > 0.001;
    if (!visible) {
      if (this.canvas && this.canvas.parentNode) this.canvas.style.display = 'none';
      this.quadCache = null;
      this.debug.box = boxOf(holder);
      return false;
    }
    if (this.canvas && this.canvas.parentNode) this.canvas.style.display = '';
    const tint = this.desiredTint();
    if (this.actor.tint !== tint) this.actor.tint = tint;

    let advanced = false;
    if (!this.paused) {
      const dt = this.lastNow ? Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000)) : 0;
      this.lastNow = now;
      if (dt > 0) {
        try { this.actor.update(dt * IDLE.timeScale); } catch {  }
        advanced = true;
      }
    }
    const surfaceChanged = this.mode === 'compose' ? this.syncCompose(geo) : this.syncSurface();
    const scale = this.placeFrame(geo);

    const needRender = this.mode !== 'compose'
      || !this.paused
      || surfaceChanged
      || force
      || !this.canvasReady;
    if (needRender) {
      const renderStart = performance.now();
      this.app.render();
      const renderCost = performance.now() - renderStart;
      this.renders = (this.renders || 0) + 1;

      if (this.renders > 1) {
        this.renderMs = this.renderMs ? this.renderMs * 0.8 + renderCost * 0.2 : renderCost;
        this.renderSamples.push(renderCost);
        if (this.renderSamples.length > 30) this.renderSamples.shift();
      } else {
        this.renderMs = renderCost;
      }
      this.canvasReady = true;

      if (this.mode === 'compose' && (this.renders === 1 || surfaceChanged || force)) {
        this.needsStagePaint = true;
      }
    }
    this.frameCount += 1;
    const dbg = this.debug;
    dbg.loaded = true;
    dbg.mode = this.mode;
    dbg.animation = this.animation;
    dbg.box = boxOf(holder);

    dbg.mask = null;
    dbg.clipSource = 'none (SPINE-SPEC §8: fold_mask_spine has no RectMask2D; cleaner clips only its own clear quad)';
    dbg.bufferBox = this.bufferBox ? { ...this.bufferBox } : null;
    dbg.envelope = this.envelope ? { ...this.envelope } : null;
    dbg.foldMask = geo.foldMask ? boxOf(geo.foldMask) : null;
    dbg.stencilCleaner = geo.cleaner ? boxOf(geo.cleaner) : null;
    dbg.scale = scale;
    dbg.tint = `#${tint.toString(16).padStart(6, '0')}`;
    dbg.paused = this.paused;
    dbg.time = this.time();
    dbg.frames = this.frameCount;
    dbg.renderMs = Math.round(this.renderMs * 1000) / 1000;
    dbg.renders = this.renders || 0;
    dbg.renderMeanMs = this.renderSamples.length
      ? Math.round((this.renderSamples.reduce((a, b) => a + b, 0) / this.renderSamples.length) * 1000) / 1000
      : null;
    if (this.mode === 'compose') {

      const ext = this.scene && this.scene.renderer && this.scene.renderer.stage
        && this.scene.renderer.stage.stats ? this.scene.renderer.stage.stats.external : null;
      dbg.insertOrder = ext && ext.orderIndex != null ? ext.orderIndex : dbg.insertOrder;
      dbg.uploadMs = ext ? ext.uploadMs : dbg.uploadMs;
      dbg.uploadMeanMs = ext ? ext.uploadMeanMs : dbg.uploadMeanMs;
      // Whether the previous paint re-uploaded this canvas and how many paints have reused it since
      // (render/shop/cardStage.js stats.external): an idle/paused shop should show repeated skips.
      dbg.uploaded = ext ? !!ext.uploaded : dbg.uploaded;
      dbg.uploadSkipped = ext && ext.skipped != null ? ext.skipped : dbg.uploadSkipped;
      dbg.texture = this.buffer ? { w: this.buffer.w, h: this.buffer.h, source: 'canvas' } : null;
      this.quadCache = this.quad(geo, holder);
    }
    if (advanced || force || this.frameCount % 15 === 0) this.updateBoundsDebug();
    return surfaceChanged || advanced;
  }


  placeFrame(geo) {
    const { holder } = geo;
    const inCompose = this.mode === 'compose';
    const unit = inCompose ? geo.unitPx : geo.unit;
    const originBox = inCompose ? this.bufferBox : null;
    const originX = originBox ? originBox.x : 0;
    const originY = originBox ? originBox.y : 0;
    const scale = this.holderScale() * unit;
    const cx = (holder.x + holder.w * HOLDER.pivot[0] - originX) * unit;
    const cy = (holder.y + holder.h * HOLDER.pivot[1] - originY) * unit;
    this.container.position.set(cx, cy);
    this.container.scale.set(scale);
    this.container.alpha = Math.max(0, Math.min(1, Number(holder.alpha) || 1));

    if (inCompose && this.buffer) {
      this.maskGraphics.clear();
      this.maskGraphics.beginFill(0xffffff, 1);
      this.maskGraphics.drawRect(0, 0, this.buffer.w, this.buffer.h);
      this.maskGraphics.endFill();
      this.container.mask = this.maskGraphics;
    } else {
      this.container.mask = null;
    }
    return scale;
  }


  syncCompose(geo) {
    if (!this.app) return false;
    const unitPx = geo.unitPx || this.unitPx();
    const envBox = this.envBox || this.envelopeBox() || this.fallbackBox();
    const px = {
      x: Math.floor(envBox.x * unitPx),
      y: Math.floor(envBox.y * unitPx),
      w: 0,
      h: 0,
    };
    px.w = Math.max(1, Math.ceil((envBox.x + envBox.w) * unitPx) - px.x);
    px.h = Math.max(1, Math.ceil((envBox.y + envBox.h) * unitPx) - px.y);
    const key = `${px.x},${px.y},${px.w}x${px.h}@${unitPx}`;
    if (key === this.surfaceKey) return false;
    this.surfaceKey = key;
    this.bufferPx = px;
    this.buffer = { w: px.w, h: px.h };

    this.bufferBox = { x: px.x / unitPx, y: px.y / unitPx, w: px.w / unitPx, h: px.h / unitPx };
    this.app.renderer.resize(px.w, px.h);
    this.canvasReady = false;
    this.needsStagePaint = true;
    return true;
  }


  animating() {
    return !this.dead && this.mode === 'compose' && !this.hidden && !!this.app && !this.paused;
  }


  consumePaintRequest() {
    if (!this.needsStagePaint) return false;
    this.needsStagePaint = false;
    return true;
  }


  quad(geo = this.geometry(), holder = geo && geo.holder) {
    if (this.mode !== 'compose' || this.hidden || !this.canvas || !geo || !holder) return null;
    if (this.frameCount < 1 || !this.bufferBox) return null;
    return {
      source: this.canvas,
      box: { ...this.bufferBox },

      clipRect: null,

      alpha: 1,
      alphaApplied: true,
      ready: true,
      premultiplied: true,
      path: SPINE_PATHS.holder,
      name: 'closure_spine_holder',
      orderIndex: null,
      // The compose canvas only changes when tick() actually renders the PIXI app, so the render count is a
      // per-frame version: the shop stage (render/shop/cardStage.js) re-uploads the canvas only when it moves
      // and reuses the GPU copy otherwise. A resize resets canvasReady, which forces a render and bumps it.
      version: this.renders || 0,
    };
  }


  time() {
    try {
      const tracks = this.actor.state.tracks;
      const track = tracks && tracks[0];
      if (track && Number.isFinite(track.trackTime)) return Math.round(track.trackTime * 1000) / 1000;
    } catch {  }
    return 0;
  }


  updateBoundsDebug() {
    if (!this.actor) return;
    try {
      const b = this.actor.getLocalBounds();
      const scale = this.debug.scale || 1;
      const round = (v) => Math.round(Number(v || 0) * 100) / 100;
      this.debug.bounds = {
        x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height),
        units: 'spine',
        px: { x: round(b.x * scale), y: round(b.y * scale), w: round(b.width * scale), h: round(b.height * scale) },
        setup: this.skeletonBounds,
      };

      if (this.mode === 'compose') {
        const s = this.holderScale();
        const c = this.center();
        this.growToFit({ x: c.x + b.x * s, y: c.y + b.y * s, w: b.width * s, h: b.height * s });
      }
    } catch {  }
  }


  seek(t) {
    if (!this.actor) return null;
    const seconds = Math.max(0, Number(t) || 0);
    this.paused = true;
    this.frozenTime = seconds;
    try {
      this.actor.state.clearTracks();
      this.actor.state.setAnimation(0, this.animation, true);
      this.actor.state.update(seconds);
      this.actor.update(0);
    } catch (err) { this.debug.error = String((err && err.message) || err); }
    this.tick(performance.now(), true);
    return this.debug;
  }


  pause(paused = true) {
    this.paused = !!paused;
    this.lastNow = 0;
    this.debug.paused = this.paused;
    return this.debug;
  }


  setHidden(hidden) {
    this.hidden = !!hidden;
    this.tick(performance.now(), true);
    return this.debug;
  }

  destroy() {
    this.dead = true;
    if (this.app) {
      try { this.app.destroy(true, { children: true, texture: false, baseTexture: false }); } catch {  }
    }
    // Release the atlas pages this view owns (an imported pack only: an official pack's textures are shared
    // and must outlive this view). destroy() is guarded because a page may already be gone.
    for (const base of this.ownedTextures || []) {
      try { if (base && !base.destroyed) base.destroy(); } catch {  }
    }
    this.ownedTextures = [];
    // app.destroy(true) removes the view it was given; this also covers a canvas whose app never came up.
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.app = null;
    this.actor = null;
    this.canvas = null;
    this.container = null;
    this.maskGraphics = null;
    this.spineData = null;
    this.quadCache = null;
  }
}

/**
 * The atlas page base textures a skeleton draws with: a pixi-spine region carries its texture atlas page, whose
 * `baseTexture` the PIXI app never owns. Only used for a skeleton built from an imported pack's bytes.
 * @param {any} data pixi-spine SkeletonData
 */
function atlasBaseTextures(data) {
  const out = new Set();
  for (const skin of (data && data.skins) || []) {
    for (const slot of Object.values((skin && skin.attachments) || {})) {
      for (const attachment of Object.values(slot || {})) {
        const page = attachment && attachment.region && attachment.region.page;
        const base = page && page.baseTexture;
        if (base && !base.destroyed) out.add(base);
      }
    }
  }
  return [...out];
}


function boxOf(box) {
  if (!box) return null;
  const round = (v) => Math.round(Number(v || 0) * 100) / 100;
  return { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h), shown: box.shown, alpha: box.alpha };
}


function surfaceOf(shop, host) {
  const rect = shop.getBoundingClientRect();
  const hostRect = host && host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 };
  const width = rect.width || shop.clientWidth || shop.width || 1;
  const height = rect.height || shop.clientHeight || shop.height || 1;
  const left = rect.left - hostRect.left + (host.scrollLeft || 0);
  const top = rect.top - hostRect.top + (host.scrollTop || 0);
  const round = (v) => Math.round(v * 1000) / 1000;
  return { width: round(width), height: round(height), left: round(left), top: round(top) };
}


function applyBox(canvas, size) {
  canvas.style.left = `${size.left}px`;
  canvas.style.top = `${size.top}px`;
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
}
