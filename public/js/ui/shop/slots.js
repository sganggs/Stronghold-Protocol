

import { SimpleLayoutContent, UIButton, UIViewStatusDriver } from './widgets.js';
import { scriptsOf, resolveScriptRefs, findPath } from './prefab.js';

const MOUNT_PATHS = [
  'root/panel_main/btn_card/group_frame/frame_obj_container',
  'root/panel_main/btn_card/root_tier/chess_level_obj_container',
];

/**
 * The theme colours to render a card with. The card model carries both the resolved fields and the theme
 * colour map; after a refresh the fields can fall back to the built-in white defaults while the map is
 * still the pack's (or vice versa), so resolve from the map first. Pure for the refresh regression test.
 * @param {any} model
 * @returns {{ nameColor: string, bondColor: string }}
 */
export function cardThemeColors(model) {
  const colors = (model && model.colors) || {};
  return {
    nameColor: colors.chessNameColor || (model && model.nameColor) || '#FFFFFF',
    bondColor: colors.bondColor || (model && model.bondColor) || '#000000',
  };
}

/** A card model with the theme colours applied explicitly (RenderView then cannot keep a white clone). */
export function cardRenderModel(model) {
  if (!model) return model;
  const { nameColor, bondColor } = cardThemeColors(model);
  if (model.nameColor === nameColor && model.bondColor === bondColor) return model;
  return { ...model, nameColor, bondColor };
}

export function cardKey(model) {
  if (!model) return 'null';
  return [
    model.slotId, model.tier, model.level, model.currCoin, model.srcCoin, model.srcPrice, model.price,
    model.isFrozen ? 1 : 0, model.armed ? 1 : 0, model.armedAt || 0,
    model.isEmpty ? 1 : 0, model.isHandFull ? 1 : 0,
    model.hasSame ? 1 : 0, model.canComb ? 1 : 0, model.hasFusePartner ? 1 : 0,
    model.id, model.name, model.icon, model.bonds === false ? 0 : 1,
  ].join('|');
}

/** Whether a reused card root must be rebuilt because the slot's content kind changed. */
export function cardNeedsRebuild(prev, next) {
  return !prev || prev.slotId !== next.slotId
    || !!prev.isEmpty !== !!next.isEmpty
    || !!prev.isChar !== !!next.isChar;
}

function mountBases(root) {
  return MOUNT_PATHS
    .map((path) => findPath(root, path))
    .filter(Boolean)
    .map((node) => [node, [...(node.children || [])]]);
}

/** The card prefab's panel_main/hot_spot UIButton._clickGuard (cooldown bool + seconds). */
function cardClickGuard(root) {
  const walk = (node) => {
    if (!node) return null;
    const path = String(node.path || '');
    if (path === 'panel_main/hot_spot' || path.endsWith('/panel_main/hot_spot')) {
      const comp = (node.components || []).find((c) => c && c.class === 'UIButton');
      if (comp && comp.fields && comp.fields._clickGuard) return comp.fields._clickGuard;
    }
    for (const child of node.children || []) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
}

function resetMounts(view) {
  for (const [node, children] of view.__mountBases || []) node.children = [...children];
}

export class CardListAdapter {

  constructor({ scene, row, buildCard }) {
    this.scene = scene;
    this.row = row;
    this.buildCard = buildCard;
    this.slotList = [];
    this.onConfirmClick = null;
    this.selectSlot = null;
    this.isSpecialRecruit = false;
    this.skinContext = null;
    this.views = [];
  }

  GetCount() {
    return this.slotList.length;
  }

  GetView(position) {
    const view = this.scene.cardViews && this.scene.cardViews[position];
    return view ? view.root : null;
  }

  TraverseCards() {
    return (this.scene.cardViews || []).filter(Boolean);
  }
}

export class AutoChessStylizedShopSlotsPanel {

  constructor({ scene, root }) {
    this.scene = scene;
    this.root = root;
    this.index = scene.index;
    const entry = scriptsOf(root, 'AutoChessStylizedShopSlotsPanel')[0];
    if (!entry) throw new Error('root_layout: AutoChessStylizedShopSlotsPanel component not found');
    const resolved = resolveScriptRefs(entry, this.index);
    this.refs = resolved.refs;
    // The panel's refresh animations are script *anims* ({ clip, on }), not refs: the entry's refs only bind
    // _slotList. Keep them too so playRefreshClip reads the clip the player actually sees.
    this.anims = resolved.anims;
    this.row = this.refs._slotList || findPath(root, 'group_slots');
    this.slotList = new SimpleLayoutContent(this.row);
    this.adapter = null;
    this.refreshSeq = null;
    this.lastRefresh = null;
    this.refreshAnim = null;

    this.views = [];

    this.cardAnims = new Map();
  }

  _initIfNot() {
    if (this.adapter) return;
    this.adapter = new CardListAdapter({
      scene: this.scene,
      row: this.row,
      buildCard: (model, index) => this.scene.buildCard(model, index),
    });
    this.slotList.set_adapter(this.adapter);
  }

  playRefreshClip(isSpecial) {
    const anim = isSpecial ? this.anims._refreshSpecAnim : this.anims._refreshAnim;
    return (anim && anim.clip) || null;
  }

  animate(view, clipName) {
    const clip = (this.scene.cardDoc.clips || {})[clipName];
    if (!clip || !view || !view.root) return false;
    const entry = (view.root.__clips || []).find((item) => item.clipName === clipName);
    if (!entry) return false;
    entry.t = 0;
    const anims = this.cardAnims.get(view.root) || {};
    anims[clipName] = { start: performance.now(), len: Number(clip.len) || 0 };
    this.cardAnims.set(view.root, anims);
    return true;
  }

  restore(view, now = performance.now()) {
    const anims = this.cardAnims.get(view.root);
    if (!anims) return;
    for (const [name, anim] of Object.entries(anims)) {
      const entry = (view.root.__clips || []).find((item) => item.clipName === name);
      if (!entry) { delete anims[name]; continue; }
      entry.t = Math.min(anim.len, Math.max(0, (now - anim.start) / 1000));
    }
  }

  startCardAnims(view, model, { fresh = false, refresh = false } = {}) {
    const prev = view.__prev || { armed: false, frozen: false };

    if (refresh) {
      if (typeof view.PlayRefreshAnim === 'function') view.PlayRefreshAnim();
      this.animate(view, 'single_card_refresh');
    }
    if (model.armed && !prev.armed) this.animate(view, 'btn_double_check');
    if (model.isFrozen && !prev.frozen && !fresh) this.animate(view, 'card_frozen');
  }

  tickCards(now = performance.now()) {
    let any = false;
    for (const [root, anims] of [...this.cardAnims]) {
      const clips = root.__clips || [];
      for (const [name, anim] of Object.entries(anims)) {
        const entry = clips.find((item) => item.clipName === name);
        if (!entry) { delete anims[name]; continue; }
        const t = Math.min(anim.len, Math.max(0, (now - anim.start) / 1000));
        entry.t = t;
        any = true;
        if (t >= anim.len) delete anims[name];
      }
      if (!Object.keys(anims).length) this.cardAnims.delete(root);
    }
    return any;
  }

  activeCardAnims() {
    const out = {};
    for (const [root, anims] of this.cardAnims) {
      out[root.path || root.name] = Object.keys(anims);
    }
    return out;
  }

  cardButtons() {
    return this.views.map((view) => view.button).filter(Boolean);
  }

  setHover(index) {
    this.views.forEach((view, position) => {
      if (view.button) view.button.setHover(position === index);
    });
  }

  snapshot() {
    const scene = this.scene;
    const panel = {};
    for (const path of ['state_unfold', 'state_able', 'state_disable', 'btn_close', 'root_text_unfold',
      'state_unfold/panel_unfold/root_layout/group_slots', 'state_unfold/panel_unfold/root_layout/group_upgrade']) {
      const node = findPath(scene.panel, path);
      panel[path] = node ? node.active !== false : null;
    }
    const cards = this.views.map((view, index) => {
      const strip = findPath(view.root, 'root/panel_main/btn_double_check');
      return {
        index,
        slotId: view.model && view.model.slotId,
        armed: !!(view.model && view.model.armed),
        frozen: !!(view.model && view.model.isFrozen),
        phase: view.ui ? view.ui.phase : null,
        strip: strip ? strip.active !== false : null,
        clips: (view.root.__clips || []).map((entry) => ({ name: entry.clipName, t: Math.round(Number(entry.t) * 10000) / 10000 })),
        tint: view.button ? { kind: view.button.tintKind, value: view.button.tint.map((v) => Math.round(v * 10000) / 10000) } : null,
      };
    });
    const coin = (scene.moneyRoot && findPath(scene.moneyRoot, 'coin_num')) || null;
    return {
      state: scene.state,
      panel,
      cards,
      coin: coin && coin.text ? coin.text.text : null,
      tracks: scene.motion.keys(),
    };
  }

  Render(data) {
    this._initIfNot();

    this.adapter.onConfirmClick = data.onCardConfirm;
    this.adapter.slotList = Array.isArray(data.slots) ? data.slots : [];
    this.adapter.selectSlot = data.selectSlot;
    this.adapter.isSpecialRecruit = !!data.isSpecialRecruit;
    this.adapter.skinContext = data.skinContext || null;

    // refreshSeq starts at null: the first Render only records the sequence (a mount is not a refresh), and
    // every later change plays the panel's own script clip (normal/special) before/with the card clips.
    // C# AutoChessStylizedShopSlotsPanel.Render: Kill old m_refreshAnim → PlayWithTween(clip) → TraverseCards
    // PlayRefreshAnim. The clip name comes from the panel's script anims, never from rewardOffer.
    const seq = Number(data.refreshSeq) || 0;
    const refresh = this.refreshSeq !== null && this.refreshSeq !== seq;
    this.refreshSeq = seq;
    if (refresh) {
      this.lastRefresh = this.playRefreshClip(!!data.isSpecialRecruit);
      if (this.lastRefresh && this.scene && this.scene.motion) {
        this.scene.motion.play('slots-refresh', this.lastRefresh, {
          doc: this.scene.panelDoc,
          basePath: this.root.path,
        });
      }
    }
    this.reconcile(this.adapter.slotList, data, refresh);
    return this;
  }

  reconcile(slots, data, refresh) {
    const prev = this.views;
    const next = [];
    const roots = [];
    for (let index = 0; index < slots.length; index += 1) {
      const model = slots[index];
      let view = prev[index];
      let fresh = false;
      const prevModel = view && view.model;
      // Slot identity alone is not enough: an empty slot can later be filled, and an operator slot can
      // become an equipment slot in the reward row. Either change needs a fresh card root, or the reused
      // root keeps the empty frame (dark card) or the operator face (no equipment icon).
      const needsRebuild = cardNeedsRebuild(prevModel, model);
      if (needsRebuild) {
        const root = this.scene.buildCard(model, index);
        if (!root) continue;
        view = this.scene.cardViews[index];
        view.__mountBases = mountBases(root);
        view.__prev = { armed: false, frozen: false };
        view.__fastMode = true;
        fresh = true;

        view.button = new UIButton({
          interactable: true,
          clickGuard: cardClickGuard(root),
          tintRoot: root,
          tintTargets: this.scene.tintTargets.card,
        });

      }
      view.index = index;
      const renderModel = cardRenderModel(model);
      view.model = renderModel;

      resetMounts(view);
      view.RenderView({ model: renderModel, selectSlot: data.selectSlot || model.selectSlot || null, isSpecialRecruit: !!data.isSpecialRecruit });

      if (this.scene.statusEnabled && !view.statusDriver && this.scene.pathIdMap) {
        view.statusDriver = UIViewStatusDriver.fromPathIdMap(this.scene.pathIdMap, {
          prefab: 'autochess_shop_card_item',
          root: view.root,
        });
      }
      if (view.statusDriver) {
        view.statusDriver.SetStatus(model.isFrozen ? 'fx_frozen_on' : 'fx_frozen_off');
        const repeated = !!(model.hasFusePartner || (model.canComb && model.hasSame));
        view.statusDriver.SetStatus(repeated ? 'fx_triple_on' : 'fx_triple_off');
      }

      this.restore(view);
      this.startCardAnims(view, renderModel, { fresh, refresh });
      view.__prev = { armed: !!model.armed, frozen: !!model.isFrozen };
      view.__fastMode = false;
      next.push(view);
      roots.push(view.root);
    }

    for (const view of prev) {
      if (!next.includes(view)) this.cardAnims.delete(view.root);
    }
    this.views = next;
    this.scene.cardViews = next;
    this.scene.cardRoots = roots;
    this.adapter.views = roots;

    if (this.row) this.row.children = roots;
  }
}
