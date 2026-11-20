

import { ChromeViewData, SlotsViewData, CtrlViewData, UpgradeViewData } from './viewData.js';
import { FadeSwitchTween } from './widgets.js';
import { countNodes, findPath } from './prefab.js';

export class AutoChessBattleShopMainView {

  constructor({ scene }) {
    this.scene = scene;
    this.cachedModel = null;
    this.skinId = 'ac_s_closur';
    this.isGoldCountUp = false;
    this.lastCoin = null;
    this.lastRenderKey = null;
    this.lastRenderKeys = [];

    this.onCardConfirm = null;

    this.mainPanelFade = new FadeSwitchTween({
      scene,
      node: scene.panel,
      key: 'panel-fade',
      duration: 0.16,
    });
    this.mainPanelFade.Reset(true);
  }

  _BuildChromeViewData(model) {
    return new ChromeViewData({
      isAvailable: model.avalid,
      isUnfold: model.unfold,
      isGoldCountUp: this.isGoldCountUp,
      canRaiseShopAvgSignal: false,
      coinCount: model.coinCount,
      level: model.level,
      remainCharCnt: model.remainCharCnt,
      skinId: this.skinId,
    });
  }

  _BuildSlotsViewData(model) {
    return new SlotsViewData({
      isSpecialRecruit: model.isSpecialRecruit,
      refreshSeq: model.refreshSeq,
      selectSlot: model.selectSlot,
      slots: model.slots,
      onCardConfirm: this.onCardConfirm,
    });
  }

  _BuildCtrlViewData(model) {
    return new CtrlViewData({
      isSpecialRecruit: model.isSpecialRecruit,
      isSpecRefresh: model.isSpecRefresh,
      isFrozen: model.isFrozen,
      coinCount: model.coinCount,
      refreshCost: model.refreshCost,
      freeRefreshCnt: model.freeRefreshCnt,
    });
  }

  _BuildUpgradeViewData(model) {
    return new UpgradeViewData({
      coinCount: model.coinCount,
      level: model.level,
      maxLevel: model.maxLevel,
      upgradeCost: model.upgradeCost,
      upgradeCostColor: model.upgradeCostColor,
      selectSlot: model.selectSlot,
      skinId: this.skinId,
    });
  }

  _RenderShopMainPanels(model) {
    this.lastRenderKeys = [];
    if (!model || !model.show) return false;
    this.scene.chrome.Render(this._BuildChromeViewData(model));
    this.lastRenderKeys.push('shop_chrome');
    if (model.avalid && model.unfold) {
      this.scene.slots.Render(this._BuildSlotsViewData(model));
      this.lastRenderKeys.push('shop_slots');
      this.scene.ctrl.Render(this._BuildCtrlViewData(model));
      this.lastRenderKeys.push('shop_ctrl');
      this.scene.upgrade.Render(this._BuildUpgradeViewData(model));
      this.lastRenderKeys.push('shop_upgrade');
    }
    return true;
  }

  invalidate() {
    this.lastRenderKey = null;
  }

  UpdateView(model, { paint = true } = {}) {
    this.cachedModel = model;
    const gained = this.lastCoin != null && Number(model.coinCount) > this.lastCoin;
    this.isGoldCountUp = gained;
    this.lastCoin = Number(model.coinCount);
    const key = renderKey(model);
    if (key !== this.lastRenderKey) {
      this.lastRenderKey = key;

      const shown = !!model.show;
      const ran = this._RenderShopMainPanels(model);
      if (ran) {
        // Any render re-applies widget actives; drop the snapshot captured before it so the next paint
        // does not restore the old toggle/confirm state over the model.
        this.scene.animBase = null;
        this.scene.hideRuntimePlaceholders();
        this.scene.markDirty('layout');
      } else {
        this.scene.dirty = false;
      }
      void shown;
    }

    this.mainPanelFade.set_isShow(!!model.show);

    if (gained && this.scene.moneyRoot) {
      this.scene.motion.play('money', 'fx_gain_money', {
        doc: this.scene.moneyDoc,
        basePath: this.scene.moneyRoot.path,
      });
    }
    if (paint) this.scene.paint({ clips: this.scene.motion.clipTracks() });
    return this.metrics();
  }

  metrics() {
    const scene = this.scene;
    const model = this.cachedModel || {};
    const cardBoxes = scene.cardRoots.map((root, index) => {
      const box = scene.frame.boxes.get(root.path);
      return box ? { index, x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) } : { index, missing: true };
    });
    const visible = cardBoxes.filter((c) => !c.missing);
    const pitch = visible.length >= 2
      ? { dx: round(visible[1].x - visible[0].x), dy: round(visible[1].y - visible[0].y) } : null;
    const bounds = unionBounds(visible);

    const materials = materialReport(scene);
    const textures = textureReport(scene);
    const nodes = {
      panelDoc: scene.panelDoc.nodeCount,
      composed: countNodes(scene.panel),
      cardDoc: scene.cardDoc.nodeCount,
      cards: scene.cardRoots.reduce((n, root) => n + countNodes(root), 0),
      moneyDoc: scene.moneyDoc.nodeCount,
      costViews: countCostViews(scene),
    };
    return {
      state: scene.state,
      nodes,
      records: scene.recordStats,
      pitch,
      cardBoxes,
      bounds,
      unresolved: unresolvedNodes(scene),
      materials,
      textures,
      panelBounds: panelBounds(scene),
      renderKeys: this.lastRenderKeys,
      skeleton: {
        spineHolders: countSpine(scene.panel),
        spineNote: null,
      },
      layout: {
        unit: round(scene.renderer.unit()),
        unitCss: round(scene.unitCss),
        dpr: scene.dpr,
        canvasCss: [scene.canvas.style.width, scene.canvas.style.height],
        design: scene.size,
      },
      level: model.level,
      coin: model.coinCount,
      errors: scene.errors.slice(0, 12),
    };
  }
}

function round(v) {
  return Math.round(Number(v) * 1000) / 1000;
}

function renderKey(model) {
  if (!model) return 'null';
  if (!model.show) return 'hidden';
  const slots = (model.slots || []).map((s) => (s ? [
    s.slotId, s.tier, s.level, s.currCoin, s.srcCoin, s.srcPrice, s.price,
    s.isFrozen ? 1 : 0, s.armed ? 1 : 0, s.armedAt || 0,
    s.isEmpty ? 1 : 0, s.isHandFull ? 1 : 0,
    s.hasSame ? 1 : 0, s.canComb ? 1 : 0, s.hasFusePartner ? 1 : 0,
    s.id, s.name, s.icon, s.bonds === false ? 0 : 1,
    // The content the card paints beyond its id: the portrait/profession mark/garrison icon are data-derived
    // URLs, the bond rows carry their own names/icons and the two colours come from the theme pack. All of
    // them are stable across m.private pushes, so they only add a re-render when the data or theme changes.
    s.profession || '', s.portraitFile || '', s.profMarkFile || '', s.garrisonIconFile || '',
    s.nameColor || '', s.bondColor || '',
    (s.bondList || []).map((b) => `${b.id}:${b.name}:${b.iconId || ''}:${b.iconFile || ''}`).join(','),
  ].join(',') : '-')).join(';');
  return [
    model.avalid ? 1 : 0,
    model.unfold ? 1 : 0,
    model.coinCount,
    model.level,
    model.maxLevel,
    model.upgradeCost,
    model.upgradeCostColor || '',
    model.refreshCost,
    model.freeRefreshCnt,
    model.refreshSeq,
    model.isFrozen ? 1 : 0,
    model.isSpecialRecruit ? 1 : 0,
    model.isSpecRefresh ? 1 : 0,
    model.remainCharCnt,
    model.selectSlot ? `${model.selectSlot.slotId}:${model.selectSlot.isUpgrade ? 1 : 0}` : '-',
    slots,
  ].join('|');
}

function unionBounds(boxes) {
  if (!boxes.length) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
}

function panelBounds(scene) {
  const rootRect = (scene.panelDoc && scene.panelDoc.root && scene.panelDoc.root.rect) || {};
  const size = rootRect.sizeDelta || [0, 286];
  const w = Number(size[0]) > 0 ? Number(size[0]) : scene.size[0];
  const h = Number(size[1]) || 286;
  return { x: 0, y: round(scene.size[1] - h), w: round(w), h: round(h) };
}

function materialReport(scene) {
  const resolve = (key) => scene.stageMaterials[key] || (scene.cardDoc.materials && scene.cardDoc.materials[key]) || null;
  const used = new Set();
  const unresolved = new Set();
  for (const rec of scene.frame.records) {
    const image = rec.node && rec.node.image;
    const raw = rec.node && rec.node.raw;
    const key = (raw && raw.mat) || (image && (image.mat || (image.material && image.material.name))) || null;
    if (!key) continue;
    used.add(String(key));
    if (!resolve(key)) unresolved.add(String(key));
  }
  return { used: used.size, resolved: used.size - unresolved.size, unresolved: [...unresolved] };
}

function textureReport(scene) {
  let ready = 0;
  const pending = [];
  for (const [url, entry] of scene.renderer.textures) {
    if (entry && entry.ready) ready += 1;
    else pending.push(url);
  }
  return { ready, pending: pending.length, pendingUrls: pending.slice(0, 20) };
}

function countSpine(root) {
  let n = 0;
  (function walk(node) {
    if (!node) return;
    if ((node.components || []).some((c) => c && (c.class === 'SkeletonGraphic' || c.class === 'UISpineHolder'))) n += 1;
    for (const child of node.children || []) walk(child);
  })(root);
  return n;
}

function unresolvedNodes(scene) {
  const byReason = {};
  const visibleByReason = {};
  let total = 0;
  let visible = 0;
  const walk = (node, parentActive) => {
    if (!node) return;
    const active = parentActive && node.active !== false;
    if (node.__unresolved) {
      total += 1;
      byReason[node.__unresolved] = (byReason[node.__unresolved] || 0) + 1;
      if (active) {
        visible += 1;
        visibleByReason[node.__unresolved] = (visibleByReason[node.__unresolved] || 0) + 1;
      }
    }
    for (const child of node.children || []) walk(child, active);
  };
  walk(scene.panel, true);
  for (const root of scene.cardRoots) walk(root, true);
  walk(scene.moneyRoot, true);
  return { total, visible, byReason, visibleByReason };
}

function countCostViews(scene) {
  let n = 0;
  const walk = (node) => {
    if (!node) return;
    if (node.path && node.path.endsWith('/cost')) n += 1;
    for (const child of node.children || []) walk(child);
  };
  walk(scene.panel);
  return n;
}

void findPath;
