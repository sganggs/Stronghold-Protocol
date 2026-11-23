

import { createCardRenderer, buildRecords as buildWebgl, roleBoxes } from '../../render/shop/cardWebgl.js';
import { cardSize, propagateTransforms, relayoutAnimatedSizes } from '../../render/shop/cardRecords.js';
import { applyClip } from '../../render/shop/cardTimeline.js';
import { CardParticles } from '../../render/shop/cardParticles.js';
import { applyActiveCurves } from './anim.js';
import { layoutScene, createMeasure, DESIGN_W, DESIGN_H } from './layoutAdapter.js';
import { cloneNode, countNodes, indexNodes, findPath, setActive, componentRefs, hideExternalSprites, hideRuntimeSources, hidePlatformHints } from './prefab.js';
import { AutoChessStylizedShopChromePanel } from './chrome.js';
import { AutoChessStylizedShopCtrlPanel } from './ctrl.js';
import { AutoChessStylizedShopSlotsPanel } from './slots.js';
import { AutoChessStylizedShopUpgradePanel } from './upgrade.js';
import { AutoChessBattleShopCardView } from './cardView.js';

const CARD_ROW = 'state_unfold/panel_unfold/root_layout/group_slots';

const MONEY_HOLDER = 'root_main_money';

// Ring centre of the sprite files, marked by the reviewer on the 10x grid export: the fully filled cell is
// sprite pixel (23, 20), so its centre is (23.5, 20.5) of 48 -> (0.4896, 0.4271). The alpha bbox centre
// (23.5, 23.5) is lower because the arrow's tail sits under the ring; an edge-circle fit got y right but
// x wrong (22.65, 20.64).
const RING_CENTER_UV = { refresh_icon: [0.4896, 0.4271] };

// The properties a uGUI clip addresses (cardTimeline applies these). A Spine clip addresses bones instead
// (`img.r/g/b/a` on paths like `2`), which no panel node can sample — loop_spine_deco must not be treated as a
// node loop, or the deco bone would keep the shop painting every frame while nothing on it changes.
const AUTO_CLIP_PROPS = new Set(['ax', 'ay', 'h', 'w', 'alpha', 'scale', 'rot', 'rz', 'colour', 'color', 'tex', 'active']);

function repath(node, basePath, name = node.name) {
  node.name = name;
  node.path = basePath ? `${basePath}/${name}` : name;
  for (const child of node.children || []) repath(child, node.path);
  return node;
}

export function findClip(docs, name) {
  for (const doc of docs) {
    const clip = doc && doc.clips && doc.clips[name];
    if (clip) return clip;
  }
  return null;
}

export class MotionClock {
  constructor(scene) {
    this.scene = scene;

    this.tracks = new Map();
    this.active = false;
  }

  play(key, clipName, opts = {}) {
    const doc = opts.doc || null;
    const docs = doc ? [doc] : [this.scene.panelDoc, this.scene.cardDoc, this.scene.moneyDoc];
    const clip = opts.clip || findClip(docs, clipName);
    if (!clip || !(Number(clip.len) > 0)) {
      if (opts.done) opts.done();
      return null;
    }
    return this.track(key, { ...opts, clip, clipName });
  }

  track(key, opts = {}) {
    const prev = this.tracks.get(key);
    if (prev && !opts.restart && prev.clipName === opts.clipName) return prev;
    if (prev) this.cancel(key, 'replaced');
    const len = Number(opts.len != null ? opts.len : opts.clip && opts.clip.len) || 0;
    const track = {
      key,
      clip: opts.clip || null,
      clipName: opts.clipName || null,
      basePath: opts.basePath ?? null,
      card: opts.card || null,
      len,
      start: performance.now(),
      t: opts.fastMode ? len : 0,
      fastMode: !!opts.fastMode,
      finished: false,
      onSample: opts.onSample || null,
      onDone: opts.done || null,
      onCancel: opts.onCancel || null,
    };
    this.tracks.set(key, track);
    this.active = true;
    this.scene.beginAnimation();
    return track;
  }

  cancel(key, reason = 'cancelled') {
    const track = this.tracks.get(key);
    if (!track) return false;
    this.tracks.delete(key);
    this.active = this.tracks.size > 0;
    if (!this.active) this.scene.endAnimation();
    if (track.onCancel) track.onCancel(reason);
    return true;
  }

  cancelAll(reason = 'cancelled') {
    for (const key of [...this.tracks.keys()]) this.cancel(key, reason);
  }

  tick(now = performance.now()) {
    for (const track of this.tracks.values()) {
      if (track.len <= 0) {
        track.t = 0;
        track.finished = true;
      } else {
        track.t = Math.min(track.len, Math.max(0, (now - track.start) / 1000));
        if (track.t >= track.len) track.finished = true;
      }
      if (track.onSample) track.onSample(track.t, track);
    }
    return [...this.tracks.values()];
  }

  flushFinished() {
    const done = [];
    for (const [key, track] of [...this.tracks]) {
      if (!track.finished) continue;
      this.tracks.delete(key);
      if (track.onDone) done.push(track.onDone);
    }
    this.active = this.tracks.size > 0;
    if (!this.active) this.scene.endAnimation();
    return done;
  }

  clipTracks() {
    return [...this.tracks.values()]
      .filter((track) => track.clip)
      .map((track) => ({ clip: track.clip, clipName: track.clipName, t: track.t, basePath: track.basePath, key: track.key }));
  }

  keys() {
    return [...this.tracks.keys()];
  }

  get busy() {
    return this.tracks.size > 0;
  }
}

function hidePcKeyHints(root) {
  if (!root) return root;
  (function walk(node) {
    if (!node) return;
    const name = String(node.name || '');
    const classes = (node.components || []).map((c) => c && c.class);
    const isPcKeyHolder = /(^|\/)?pc_key/i.test(name) || name === 'pc_key_holder';
    const isPcHint = classes.includes('PCKeyCardUIButtonDisplay') || classes.includes('UIButtonKeyBoardConfig');
    if (isPcKeyHolder || (isPcHint && !classes.includes('UIButton'))) {
      if (node.active !== false) node.__unresolved = node.__unresolved || 'pc-only';
      node.active = false;
    }
    for (const child of node.children || []) walk(child);
  })(root);
  return root;
}

function cardSubClip(doc, entry) {
  if (!entry || !/^loop_tier_star_lv(5|6)$/.test(entry.clipName || '')) return null;
  const subs = (doc && doc.sub) || {};
  if (entry.sub && subs[entry.sub] && subs[entry.sub].clips) return subs[entry.sub].clips[entry.clipName] || null;
  for (const sub of Object.values(subs)) {
    const clip = sub && sub.clips && sub.clips[entry.clipName];
    if (clip) return clip;
  }
  return null;
}

/**
 * A looping clip's phase: `clock` measured from `start`, folded into `[0, len)`. The card's `loop_triple`
 * (entry.len = the clip's stop time) and a panel auto-clip (start = the moment its node became visible, so a
 * legacy Animation restarts at 0 when it is shown again) share this one formula.
 * @param {number} clock the scene clock in seconds
 * @param {number} [start] the origin (0 for the free-running card loop); a falsy value is 0
 * @param {number} len the clip length; anything not > 0 is 0.001 so the modulo stays finite
 * @returns {number} the phase in `[0, len)`
 */
export function clipPhase(clock, start, len) {
  const length = Math.max(0.001, Number(len) || 0.001);
  return ((((clock || 0) - (start || 0)) % length) + length) % length;
}

export class ShopScene {
  constructor({ theme, canvas, size = [DESIGN_W, DESIGN_H], tintTargets = null, pathIdMap = null, particlesEnabled = false, statusEnabled = true, particleComponents = null, options = {} }) {
    const self = this;
    const opts = options || {};
    this.options = opts;
    this.theme = theme;
    this.canvas = canvas;
    this.size = size;
    this.measure = createMeasure();
    this.errors = [];

    this.pathIdMap = pathIdMap;

    this.particlesEnabled = !!particlesEnabled;

    this.statusEnabled = statusEnabled !== false;

    this.particleComponents = particleComponents;

    this.tintTargets = tintTargets || { card: [], panel: [] };

    this.fades = new Map();

    this.particleAt = Number.isFinite(Number(opts.particleTime)) ? Number(opts.particleTime) : null;
    this.particleElapsed = 0;

    this.settle = new Map();
    this.stageMaterials = {};
    for (const doc of [theme.shop.prefabs.panel_shop_main, theme.shop.prefabs.autochess_main_money_item, theme.card,
      ...Object.values(theme.card.sub || {})]) {
      Object.assign(this.stageMaterials, (doc && doc.materials) || {});
    }

    this.panelDoc = theme.shop.prefabs.panel_shop_main;
    this.moneyDoc = theme.shop.prefabs.autochess_main_money_item;
    this.cardDoc = theme.card;

    this.stillCards = !!opts.still;
    this.cardTime = Number.isFinite(Number(opts.cardTime)) ? Number(opts.cardTime) : null;
    this.cardParticlesEnabled = opts.cardParticles !== false;
    this.cardClock = 0;
    this.cardClockLast = null;
    // Panel auto-clips (C# AnimationWrapper autoClip) loop for as long as their node is shown, so they are not
    // motion tracks: the phase comes from a paint clock. `loop_btn_refresh_sweep_closure` is the only uGUI one
    // in panel_shop_main (btn_refresh/group_normal); it sweeps root_special, the button's special state.
    this.autoClips = new Map();
    this.autoClipParent = new Map();
    this.autoClipClock = 0;
    this.autoClipLast = null;
    const cardMountedView = {
      // The card documents carry both frame_lv2_obj and frame_lv3_obj, each with a tv_particle. Only the
      // mounted tier sub-prefabs may emit; CardParticles reads this.
      get mounted() {
        const out = [];
        for (const root of self.cardRoots || []) {
          for (const name of (root && root.__cardMounted) || []) if (!out.includes(name)) out.push(name);
        }
        return out;
      },
    };
    this.renderer = createCardRenderer({
      view: cardMountedView,
      canvas,

      card: {
        materials: this.stageMaterials,

        sub: {},
        size: [...size],
        particles: this.bakeParticles(),
        nativeParticles: this.particlesEnabled ? this.nativeParticles() : [],
        particleComponents: this.particleComponents,
      },
      particles: (this.particlesEnabled || this.cardParticlesEnabled) ? CardParticles : null,
      cardStill: () => this.stillCards || this.cardTime != null,
      particleTime: () => (this.particleAt != null ? this.particleAt : this.particleElapsed),
      pad: { left: 0, right: 0, top: 0, bottom: 0 },
      resolveUrl: (file) => (/^\//.test(String(file)) ? file : theme.url(file)),
      onError: (message) => this.errors.push(String(message)),
    });
    this.unitCss = 1;
    this.dpr = 1;

    this.externalQuad = null;

    this.frame = { records: [], boxes: new Map(), order: [] };

    this.motion = new MotionClock(this);

    this.dirty = true;
    this.layoutDirty = true;

    this.animBase = null;

    this.arrowClock = 0;
    this.arrowClockLast = null;

    this.arrowAt = Number.isFinite(Number(opts.arrowAt)) ? Math.max(0, Number(opts.arrowAt)) : null;

    this.base = null;
    this.recordStats = { panel: 0, money: 0, cards: 0, merged: 0, materials: 0, sprites: 0, texts: 0, quads: 0 };
    this.build();

    this.spineHolderNode = findPath(this.panel, 'fold_mask_spine/closure_spine_holder');

    this.arrowNode = findPath(
      this.panel,
      'state_unfold/panel_unfold/root_layout/group_upgrade/group_normal/root_inner_front/root_arrow',
    );
    if (this.renderer && this.renderer.stage && typeof this.renderer.stage.setExternalQuad === 'function') {
      this.renderer.stage.setExternalQuad((rec) => (this.externalQuad ? this.externalQuad(rec) : null));
    }
  }

  bakeParticles() {
    const theme = this.theme || {};
    const prefabs = (theme.shop || {}).prefabs || {};
    const cardSubs = (theme.card || {}).sub || {};
    const cardTv = [];
    if (this.cardParticlesEnabled) {

      const cardRoot = (theme.card && theme.card.root) || {};
      const rootPath = cardRoot.path || 'autochess_shop_card_item';
      const innerName = (Array.isArray(cardRoot.children) && cardRoot.children[0] && cardRoot.children[0].name) || 'root';
      for (const name of ['frame_lv2_obj', 'frame_lv3_obj']) {
        for (const spec of ((cardSubs[name] || {}).particles) || []) {
          cardTv.push({ ...spec, sub: name, path: `${rootPath}/${innerName}/${spec.path || `${name}/tv_particle`}` });
        }
      }
    }
    // The card's own emitters (state_fx_triple/particle_ctrl: the star sparks, plus any card-level
    // effects) are part of the card, not the optional panel-particle debug switch. Their system only draws
    // while the owning node is active, so include them whenever card particles are enabled; the
    // particlesEnabled option still gates the panel/background systems.
    const cardOwned = this.cardParticlesEnabled ? ((theme.card || {}).particles || []) : [];
    if (!this.particlesEnabled) return [...cardOwned, ...cardTv];
    return [
      ...((prefabs.panel_shop_main || {}).particles || []),
      ...cardOwned,
      ...cardTv,
    ];
  }

  nativeParticles() {
    const theme = this.theme || {};
    const prefabs = (theme.shop || {}).prefabs || {};
    return [...((prefabs.autochess_main_money_item || {}).particles || [])];
  }

  particlesAnimating() {
    const renderer = this.renderer && this.renderer.stage && this.renderer.stage.particles;
    return !!(renderer && renderer.aliveCount() > 0);
  }

  cardFxAnimating() {
    if (this.stillCards) return false;
    if (this.cardTime != null) return false;
    return true;
  }

  applyArrowSizeTween(view) {
    const node = this.arrowNode;
    if (!node || !view) return;
    const rec = view.byPath(node.path);
    if (!rec) return;

    let p = rec;
    while (p) {
      if (p.active === false) return;
      p = p.parent;
    }
    const from = 93;
    const to = 105;
    const dur = 1;
    const t = Math.max(0, this.arrowClock);
    const phase = (t / dur) % 2;
    const u = phase <= 1 ? phase : 2 - phase;
    const k = 0.5 - 0.5 * Math.cos(Math.PI * u);
    rec.pose.w = from + (to - from) * k;
    rec.pose.h = 32;
    relayoutAnimatedSizes(view, this.cardDoc);
  }

  particlesInfo() {
    const renderer = this.renderer && this.renderer.stage && this.renderer.stage.particles;
    if (!renderer) return { enabled: false, reason: 'particles gated off (?particles=1 to enable)' };
    return {
      enabled: true,
      systems: renderer.systems.length,
      alive: renderer.aliveCount(),
      stats: this.renderer.stage.stats.particles,
      particleAt: this.particleAt,
      elapsed: Math.round(this.particleElapsed * 1000) / 1000,
      list: renderer.systems.map((system) => ({
        name: system.name,
        path: (system.spec && system.spec.path) || null,
        pathId: system.spec && system.spec.pathId != null ? system.spec.pathId : null,
        drawable: system.drawable,
        native: !!system.native,
        drawn: system.drawn,
        active: !!system.active,
        alive: system.alive.length,
        rect: system.rect ? { x: Math.round(system.rect.x), y: Math.round(system.rect.y), w: Math.round(system.rect.w), h: Math.round(system.rect.h) } : null,
      })),
    };
  }

  build() {
    const panelDoc = this.theme.shop.prefabs.panel_shop_main;
    this.panelDoc = panelDoc;
    this.panel = cloneNode(panelDoc.root);
    this.index = indexNodes(this.panel);
    this.components = componentRefs(this.panel, this.index);

    this.moneyDoc = this.theme.shop.prefabs.autochess_main_money_item;
    this.cardDoc = this.theme.card;

    this.chrome = new AutoChessStylizedShopChromePanel({ scene: this, root: this.panel, components: this.components });
    this.ctrl = new AutoChessStylizedShopCtrlPanel({ scene: this, root: findPath(this.panel, 'state_unfold/panel_ctrl_btn') });
    this.slots = new AutoChessStylizedShopSlotsPanel({ scene: this, root: findPath(this.panel, 'state_unfold/panel_unfold/root_layout') });
    this.upgrade = new AutoChessStylizedShopUpgradePanel({ scene: this, root: findPath(this.panel, 'state_unfold/panel_unfold/root_layout/group_upgrade') });

    this.chrome.initMoney();
    this.applyMoneyAtlases();
    this.ctrl.initCost();
    this.upgrade.initCost();
    this.cardRoots = [];
    // The card views of the last reconcile (an array, index = display slot: slots.js GetView reads it), and the
    // per-build record view keyed by the card root (paint's clip lookup). Kept apart so the rebuild below cannot
    // change the shape GetView/TraverseCards expect.
    this.cardViews = [];
    this.cardViewMap = new Map();
    this.state = 'unfold';
    this.staticActives = null;
    this.animBase = null;
    this.base = null;
    this.dirty = true;
    this.layoutDirty = true;
  }

  markDirty(reason = 'state') {
    this.dirty = true;
    if (reason === 'layout') this.layoutDirty = true;
  }

  beginAnimation() {
    if (!this.animBase) this.animBase = this.captureActives();
  }

  refreshActiveBase(node) {
    if (!node || !this.animBase) return;
    this.animBase.set(node, node.active !== false);
  }

  endAnimation() {
    this.animBase = null;
  }

  setFade(node, value) {
    if (node) this.fades.set(node, Number(value));
  }

  fadeOf(node) {
    return this.fades.get(node);
  }

  clearFade(node) {
    this.fades.delete(node);
  }

  setSettle(key, entry) {
    if (!key) return;
    if (!entry) this.settle.delete(key);
    else this.settle.set(key, entry);
  }

  clearSettle(key) {
    this.settle.delete(key);
  }

  applyMoneyAtlases() {
    const money = this.moneyRoot;
    if (!money) return;
    const map = [
      ['bg', 'sprites/bg_money.png'],
      ['root_fx/fx_back', 'sprites/fx_mask_1.png'],
      ['root_fx/fx_outline', 'sprites/fx_mask_3.png'],
      ['root_fx/fx_icon', 'sprites/fx_mask_2.png'],
    ];
    for (const [path, file] of map) {
      const node = findPath(money, path);
      if (!node || !node.image) continue;
      node.image = { ...node.image, file, sprite: file.split('/').pop().replace(/\.png$/, '') };
    }
  }

  hideRuntimePlaceholders() {
    hidePlatformHints(this.panel);
    hidePcKeyHints(this.panel);
    hideExternalSprites(this.panel, this.panelDoc.materials);
    hideRuntimeSources(this.panel, this.panelDoc.runtime, this.index, this.panelDoc.materials);
    const cardMaterials = this.cardDoc.materials || {};
    for (const root of this.cardRoots) {
      hidePlatformHints(root);
      hidePcKeyHints(root);
      hideExternalSprites(root, cardMaterials);
      hideRuntimeSources(root, this.cardDoc.runtime, indexNodes(root), cardMaterials);
    }
    if (this.moneyRoot) {
      hidePlatformHints(this.moneyRoot);
      hidePcKeyHints(this.moneyRoot);
      hideExternalSprites(this.moneyRoot, this.moneyDoc.materials || {});
    }
  }

  resize(widthCss, dpr = 1) {
    const w = Number(widthCss) || this.size[0];
    this.renderer.resize(w, this.size[0], this.size[1], dpr);
    this.unitCss = w / this.size[0];
    this.dpr = dpr;
    const [cw, ch] = [w, this.size[1] * this.unitCss];
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.markDirty('layout');
  }

  solveLayout() {
    return layoutScene(this.panel, { width: this.size[0], height: this.size[1], measure: this.measure });
  }

  rebuild() {
    if (this.layoutDirty) this.solveLayout();
    const panelDoc = this.panelDoc;
    const row = findPath(this.panel, CARD_ROW);
    const moneyHolder = findPath(this.panel, MONEY_HOLDER);

    const full = buildWebgl({ ...panelDoc, root: this.panel }, panelDoc, { size: this.size, unit: 1, pad: [0, 0] });

    const detached = [];
    const detach = (node) => {
      if (!node) return;
      detached.push([node, node.children]);
      node.children = [];
    };
    let panelBuilt;
    try {
      detach(row);
      detach(moneyHolder);
      panelBuilt = buildWebgl({ ...panelDoc, root: this.panel }, panelDoc, { size: this.size, unit: 1, pad: [0, 0] });
    } finally {
      for (const [node, children] of detached) node.children = children;
    }

    const records = [...panelBuilt.order];
    const boxes = new Map(panelBuilt.boxes);
    const byPath = new Map();
    for (const rec of records) if (rec.node && rec.node.path) byPath.set(rec.node.path, rec);
    const unit = 1;
    const shift = (rec, ox, oy) => {
      rec.abs = { ...rec.abs, x: rec.abs.x + ox, y: rec.abs.y + oy };
      if (rec.box) rec.box = { ...rec.box, x: rec.box.x + ox * unit, y: rec.box.y + oy * unit };
      if (rec.clipRect) rec.clipRect = { ...rec.clipRect, x: rec.clipRect.x + ox, y: rec.clipRect.y + oy };
      if (rec.softMask && rec.softMask.rect) {
        rec.softMask = { ...rec.softMask, rect: { ...rec.softMask.rect, x: rec.softMask.rect.x + ox, y: rec.softMask.rect.y + oy } };
      }
    };
    const rowRecord = row ? panelBuilt.byPath(row.path) : null;

    let cardCount = 0;

    this.cardViewMap = new Map();
    for (const cardRoot of this.cardRoots) {
      const origin = full.boxes.get(cardRoot.path);
      if (!origin) continue;
      const card = buildWebgl(
        { root: cardRoot, materials: this.cardDoc.materials, sub: this.cardDoc.sub, clips: this.cardDoc.clips },
        this.cardDoc,
        { size: [157, 207], unit: 1, pad: [0, 0], maskFlip: true },
      );
      const cardRootRec = card.order[0];
      if (cardRootRec && rowRecord) cardRootRec.parent = rowRecord;
      const localPaths = new Map();
      for (const rec of card.order) {
        if (rec.node && rec.node.path) localPaths.set(rec.node.path, rec);
        shift(rec, origin.x, origin.y);
        records.push(rec);
        if (rec.node && rec.node.path) byPath.set(rec.node.path, rec);
        boxes.set(rec.node.path || rec.node.name, rec.box);
      }
      this.cardViewMap.set(cardRoot, {
        order: card.order,
        byPath: (path) => localPaths.get(path) || null,
        paths: () => localPaths.keys(),
        root: cardRoot,
      });
      cardCount += card.order.length;
    }

    const moneyRoot = this.moneyRoot;
    const moneyOrigin = moneyRoot ? full.boxes.get(moneyRoot.path) : null;
    let moneyCount = 0;
    if (moneyRoot && moneyOrigin) {
      const money = buildWebgl(
        { root: moneyRoot, materials: this.moneyDoc.materials, sub: this.moneyDoc.sub },
        this.moneyDoc,
        { size: cardSize(this.moneyDoc), unit: 1, pad: [0, 0] },
      );
      const moneyRootRec = money.order[0];
      const holderRecord = moneyHolder ? panelBuilt.byPath(moneyHolder.path) : null;
      if (moneyRootRec && holderRecord) moneyRootRec.parent = holderRecord;
      for (const rec of money.order) {
        shift(rec, moneyOrigin.x, moneyOrigin.y);
        records.push(rec);
        if (rec.node && rec.node.path) byPath.set(rec.node.path, rec);
        boxes.set(rec.node.path || rec.node.name, rec.box);
        moneyCount += 1;
      }
    }

    const mask = panelBuilt.order.find((rec) => rec.node.name === 'panel_unfold' && rec.clipRect);
    if (mask) {
      for (const rec of records) {
        if (!rec.node.path || rec.node.path.startsWith('panel_shop_main')) continue;
        rec.clipRect = rec.clipRect ? intersectRect(rec.clipRect, mask.clipRect) : { ...mask.clipRect };
      }
    }

    for (const rec of records) {
      rec.baseAbs = { ...rec.abs };
      rec.baseClipRect = rec.clipRect ? { ...rec.clipRect } : null;
      rec.pose = {};
      rec.delta = { x: 0, y: 0 };
      rec.inheritAlpha = 1;
      rec.inheritScale = [1, 1];
      rec.group = false;
      rec.sizePosed = false;
    }
    this.base = {
      records,
      byPath,
      boxes,
      trees: [this.panel],
      view: {
        order: records,
        byPath: (p) => byPath.get(p) || null,
        paths: () => byPath.keys(),
        trees: [this.panel],
      },
    };
    this.base.stats = { panel: panelBuilt.order.length, cards: cardCount, money: moneyCount };
    this.collectAutoClips();
    this.dirty = false;
    this.layoutDirty = false;

    this.staticActives = null;
    if (this.motion.busy) this.animBase = this.captureActives();
  }

  /**
   * C# AnimationWrapper plays a node's script clip on a loop while the node is shown. The clip is authored
   * against its owner (`loop_btn_refresh_sweep_closure` on btn_refresh/group_normal carries root_special/…
   * curves, and root_special is a child of group_normal), so the base path is the autoClip node itself. The
   * Spine deco clip (loop_spine_deco) drops out by itself: its curves address bones (`2`, `1` + img.*) and no
   * such node path resolves.
   */
  collectAutoClips() {
    this.autoClips.clear();
    this.autoClipParent = new Map();
    const doc = this.panelDoc;
    if (!doc || !this.panel) return;
    const visit = (node, parent) => {
      if (!node) return;
      this.autoClipParent.set(node, parent || null);
      const name = node.autoClip;
      // Only the refresh button's own group runs this loop. btn_reward carries the same autoClip and its
      // root_special is active by default in the prefab, so registering it painted two more spinning arrows at
      // the reward buttons' fixed positions - the "icons flying at the left / sliding on the right" report.
      if (name && node.path && node.path.includes('/btn_refresh/group_normal') && !this.autoClips.has(node.path)) {
        const clip = (doc.clips || {})[name];
        // Targets are the clip's own nodes, so "is this loop visible" is the node's inherited active state:
        // the refresh button's root_special is toggled by ctrl and nothing paints until it is on.
        const curves = clip
          ? (clip.curves || []).filter((curve) => curve[0] && AUTO_CLIP_PROPS.has(String(curve[1]).split('.')[0]))
          : [];
        const targets = curves.map((curve) => this.autoClipNode(`${node.path}/${curve[0]}`)).filter(Boolean);
        if (clip && Number(clip.len) > 0 && targets.length) {
          // Rotation centre is the SPRITE's ring centre, not the assumed rect centre: the 48x48 refresh_icon
          // webp has its alpha bbox at x 1..45 / y 2..45, i.e. centre (23.50, 24.00) => (0.4896, 0.5000)
          // normalized. Measured from the file, see docs/SHADER-ALPHABLEND.md provenance note.
          for (const target of targets) {
            const sprite = target.image && target.image.sprite;
            target.centerRot = (sprite && RING_CENTER_UV[sprite]) || null;
          }
          this.autoClips.set(node.path, { clipName: name, clip, basePath: node.path, targets: [...new Set(targets)] });
        }
      }
      for (const child of node.children || []) visit(child, node);
    };
    visit(this.panel, null);
  }

  /** The node at a full path, walking the panel tree once (records are rebuilt per state, nodes are not). */
  autoClipNode(path) {
    const root = this.panel;
    if (!root) return null;
    const prefix = root.path ? `${root.path}/` : '';
    const full = String(path);
    if (prefix && !full.startsWith(prefix)) return null;
    let node = root;
    for (const part of full.slice(prefix.length).split('/').filter(Boolean)) {
      node = (node.children || []).find((child) => child.name === part) || null;
      if (!node) return null;
    }
    return node;
  }

  /** A node is drawn when it and every ancestor are active (uGUI activeInHierarchy). */
  autoClipShown(node) {
    for (let n = node; n; n = this.autoClipParent.get(n) || null) {
      if (n.active === false) return false;
    }
    return !!node;
  }

  /** True when an auto-clip's targets are drawn, so the host has to keep painting (these are not motion tracks).
   * A still mount (设置 → 主题动画 off / reduced motion, or a pinned card time) samples no auto-clip at all:
   * otherwise the loop would move on its own and keep the host painting every frame (ShopCanvas.shopStill). */
  autoClipAnimating() {
    if (this.stillCards || this.cardTime != null) return false;
    for (const entry of this.autoClips.values()) {
      if (entry.targets.some((node) => this.autoClipShown(node))) return true;
    }
    return false;
  }

  /** The auto-clips' current frames. Nothing plays while their nodes are hidden, so a normal shop stays idle;
   * nothing plays on a still mount either (the refresh button keeps its static pose). */
  sampleAutoClips() {
    if (!this.autoClips.size || this.stillCards || this.cardTime != null) return [];
    const now = performance.now();
    const dt = this.autoClipLast == null ? 0 : Math.min(0.05, (now - this.autoClipLast) / 1000);
    this.autoClipLast = now;
    this.autoClipClock += dt;
    const entries = [];
    for (const entry of this.autoClips.values()) {
      const live = entry.targets.some((node) => this.autoClipShown(node));
      if (!live) { entry.live = false; continue; }
      // A legacy Animation restarts at t=0 when its node becomes active again (C# m_PlayAutomatically), so a
      // free-running clock would drop the first sweep in mid-clip whenever the button turns special.
      if (!entry.live) { entry.live = true; entry.start = this.autoClipClock; }
      const len = Math.max(0.001, Number(entry.clip.len) || 0.001);
      entries.push({
        clip: entry.clip,
        clipName: entry.clipName,
        t: clipPhase(this.autoClipClock, entry.start, len),
        basePath: entry.basePath,
      });
    }
    return entries;
  }

  paint(options = {}) {
    const clips = options.clips || [];
    // The snapshot exists only while a motion clip owns the active flags. Settle clips (clips.length>0)
    // without motion must not keep restoring a snapshot from before a widget re-render.
    if (!this.motion.busy) {
      this.animBase = null;
    } else if (!this.animBase) {
      this.animBase = this.captureActives();
    }

    if (this.animBase) {
      for (const [node, active] of this.animBase) node.active = active;
    }
    if (this.dirty || !this.base) this.rebuild();

    const pinnedTime = this.cardTime != null ? this.cardTime : null;
    if (this.stillCards || pinnedTime != null || this.arrowAt != null) {
      this.arrowClock = this.arrowAt != null ? this.arrowAt : 0;
      this.arrowClockLast = null;
    } else {
      const nowMs = performance.now();
      const dt = this.arrowClockLast == null ? 0 : Math.min(0.05, (nowMs - this.arrowClockLast) / 1000);
      this.arrowClockLast = nowMs;
      this.arrowClock += dt;
    }

    const base = this.base;
    const view = base.view;
    const records = base.records;

    for (const rec of records) {
      // Reuse the pose/abs/delta objects: 844 records were allocating ~2500 objects per paint, which
      // only fed the GC. The per-frame state is fully overwritten below, so reuse is equivalent.
      const pose = rec.pose || (rec.pose = {});
      pose.ax = null;
      pose.ay = null;
      pose.h = null;
      pose.w = null;
      pose.alpha = null;
      pose.scale = null;
      pose.rot = null;
      pose.colour = {};
      pose.tex = {};
      const abs = rec.abs || (rec.abs = {});
      Object.assign(abs, rec.baseAbs);
      const delta = rec.delta || (rec.delta = {});
      delta.x = 0;
      delta.y = 0;
      rec.inheritAlpha = 1;
      rec.inheritScale = [1, 1];
      rec.group = false;
      rec.sizePosed = false;
      rec.clipRect = rec.baseClipRect ? { ...rec.baseClipRect } : null;
    }

    syncActiveFast(this.panel, view, true);

    const clipEntries = [];

    for (const [key, entry] of this.settle) {
      if (this.motion.tracks.has(key)) continue;
      const doc = entry.doc || this.panelDoc;
      const clip = (doc.clips || {})[entry.clipName];
      if (!clip) continue;
      if (clips.some((item) => item.clip === clip)) continue;
      clipEntries.push({ clip, clipName: entry.clipName, t: Number(entry.t != null ? entry.t : clip.len) || 0, basePath: entry.basePath });
    }
    for (const entry of this.extraClips || []) {
      const clip = (this.panelDoc.clips || {})[entry.clipName];
      if (clip) clipEntries.push({ clip, clipName: entry.clipName, t: entry.t, basePath: entry.basePath });
    }

    clipEntries.push(...clips);

    const moneyClip = (this.moneyDoc.clips || {}).fx_gain_money;
    const moneyAnimating = clips.some((entry) => entry.key === 'money')
      || clips.some((entry) => moneyClip && entry.clip === moneyClip);
    if (this.moneyRoot && moneyClip && !moneyAnimating) {
      clipEntries.push({ clip: moneyClip, t: Number(moneyClip.len) || 0, basePath: this.moneyRoot.path });
    }
    for (const root of this.cardRoots) {
      const local = (this.cardViewMap && this.cardViewMap.get(root)) || null;
      for (const entry of root.__clips || []) {

        const clip = (this.cardDoc.clips || {})[entry.clipName] || cardSubClip(this.cardDoc, entry);
        if (!clip) continue;

        if (clips.some((item) => item.clip === clip)) continue;

        // A still frame keeps a pinned pose: loop_triple pins the clip's stop time (tripleLoopLength), not its
        // key-frame end; entries without stillT skip the clock in still mode.
        if (entry.clock && this.stillCards && entry.stillT == null) continue;
        let t = entry.t;
        if (entry.clock) {
          if (this.stillCards) {
            t = Number(entry.stillT);
          } else {
            const len = Math.max(0.001, Number(entry.len) || Number(clip.len) || 0.001);
            t = clipPhase(this.cardClock, 0, len);
          }
        }
        clipEntries.push({
          clip,
          clipName: entry.clipName,
          t,
          basePath: entry.basePath,

          view: local,
          hermite: entry.hermite !== false,
        });
      }
    }

    // Panel auto-clips ride the same sampler as clips and settle entries; they are sampled here because their
    // phase comes from the paint clock, not from a track that finishes.
    const autoClips = this.sampleAutoClips();
    if (autoClips.length) clipEntries.push(...autoClips);

    if (clipEntries.length) {
      for (const entry of clipEntries) {
        if (!entry || !entry.clip) continue;
        applyActiveCurves(entry.view || view, entry.clip, entry.t, entry.basePath ?? null);
      }
      syncActiveFast(this.panel, view, true);
      for (const entry of clipEntries) {
        if (!entry || !entry.clip) continue;

        const linear = entry.hermite === false
          || entry.clipName === 'btn_upgrade_doublecheck_in'
          || entry.clipName === 'btn_upgrade_doublecheck_out';
        applyClip(entry.view || view, entry.clip, entry.t, entry.basePath ?? null, !linear);
      }

      relayoutAnimatedSizes(view, this.cardDoc);

      // A shop clip stores absolute m_AnchoredPosition x/y (ui_components.py: attribute 224 -> ax/ay), while
      // propagateTransforms converts a pose to delta = rest - clipValue: right for y (the boxes are top-down, so
      // its axis flips) and mirrored for x (its axis does not). Reflecting ax about the node's rest x makes x come
      // out as clipValue - rest, like y; without it the fold slides the panel content left instead of right.
      for (const rec of records) {
        const p = rec.pose;
        if (!p) continue;
        const pos = rec.pos || [0, 0];
        if (p.ax != null) p.ax = 2 * pos[0] - p.ax;
      }
    }

    if (this.fades.size) {
      for (const [node, value] of this.fades) {
        const rec = base.view.byPath(node.path);
        if (!rec) continue;
        rec.pose.alpha = (rec.pose.alpha == null ? 1 : rec.pose.alpha) * value;
        rec.group = true;
      }
    }
    this.applyArrowSizeTween(view);
    propagateTransforms(view);

    for (const rec of records) {
      const key = rec.node.path || rec.node.name;
      const box = base.boxes.get(key);
      if (!box) continue;
      const delta = rec.delta || { x: 0, y: 0 };
      box.x = (rec.abs.x + delta.x) * 1;
      box.y = (rec.abs.y + delta.y) * 1;
      box.w = rec.abs.w;
      box.h = rec.abs.h;
      box.alpha = (rec.inheritAlpha == null ? 1 : rec.inheritAlpha) * (rec.pose && rec.pose.alpha != null ? rec.pose.alpha : 1);
      box.shown = rec.active;
    }

    this.frame = { records, boxes: base.boxes, order: records };

    const pinned = pinnedTime;
    if (pinned != null) {
      this.cardClock = Number.isFinite(pinned) ? pinned : 0;
      this.cardClockLast = null;
      this.renderer.draw(records, this.cardClock);
    } else if (this.stillCards) {
      this.cardClock = 0;
      this.cardClockLast = null;
      this.renderer.draw(records, 0);
    } else {
      const nowMs = performance.now();
      const dt = this.cardClockLast == null ? 0 : Math.min(0.05, (nowMs - this.cardClockLast) / 1000);
      this.cardClockLast = nowMs;
      this.cardClock += dt;
      // renderer.draw() draws the whole stage; stage.draw(dt) draws the same records again. Draw the
      // stage once per paint: a new record array goes through renderer.draw() (which also hands the
      // array to the stage), an unchanged one only advances the clock through stage.draw().
      if (this._drawnRecords !== records) {
        this._drawnRecords = records;
        this.renderer.draw(records, null);
      } else {
        this.renderer.stage.draw(dt);
      }
    }
    const stats = this.renderer.stage.stats;
    this.recordStats = {
      panel: base.stats.panel,
      cards: base.stats.cards,
      money: base.stats.money,
      merged: records.length,
      materials: stats.materials,
      sprites: stats.sprites,
      texts: stats.texts,
      quads: stats.quads,
    };
    return this.frame;
  }

  captureActives() {
    const map = new Map();
    (function walk(node) {
      if (!node) return;
      map.set(node, node.active !== false);
      for (const child of node.children || []) walk(child);
    })(this.panel);
    return map;
  }

  hit(path, x, y) {
    const unitPx = this.renderer.unit();
    let box = null;
    for (const [key, candidate] of this.frame.boxes) {
      if (key === path || key.endsWith(`/${path}`)) { box = candidate; break; }
    }
    if (!box || !box.shown) return false;

    if (!(Number(box.alpha) > 0.01)) return false;
    const px = x / unitPx;
    const py = y / unitPx;
    return px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h;
  }

  /** Re-find the panel's spine holder after a slots/chrome re-render; the old record may have been replaced. */
  refreshSpineHolder() {
    const holder = findPath(this.panel, 'fold_mask_spine/closure_spine_holder');
    if (holder) this.spineHolderNode = holder;
    return this.spineHolderNode;
  }

  buildCard(model, index) {
    const row = findPath(this.panel, CARD_ROW);
    if (!row) return null;
    const card = cloneNode(this.cardDoc.root);
    repath(card, row.path, `card_${index}`);
    card.rect = {
      anchors: { min: [0.5, 0.5], max: [0.5, 0.5] },
      pivot: [0.5, 0.5],
      sizeDelta: [157, 207],
      anchoredPosition: [0, 0],
    };
    const view = new AutoChessBattleShopCardView({ scene: this, root: card, model, index });
    this.cardViews[index] = view;
    this.cardRoots.push(card);
    return card;
  }

  roleBoxes() {
    return roleBoxes(this.panelDoc, { boxes: this.frame.boxes });
  }
}

function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
  };
}

/**
 * Apply the node tree's active flags to the records, looking each node up by path.
 *
 * cardRecords.syncActive scans the whole record order for every node (O(nodes x records): ~840k
 * comparisons per call and it runs twice per paint, which cost ~64ms/s at idle on the desktop GPU).
 * The record index already has a byPath map, so the same result costs one walk.
 */
function syncActiveFast(node, view, parentActive) {
  if (!node) return;
  const active = parentActive && node.active !== false;
  const rec = view && view.byPath ? view.byPath(node.path) : null;
  if (rec) rec.active = active;
  for (const child of node.children || []) syncActiveFast(child, view, active);
}

export function solveLayout(scene) {
  return scene.solveLayout();
}

export { setActive, countNodes, DESIGN_W, DESIGN_H };
