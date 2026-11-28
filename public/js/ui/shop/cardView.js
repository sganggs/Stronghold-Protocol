

import { cloneNode, setActive } from './prefab.js';
import { TwoPhaseButtonWidget } from './widgets.js';
import { t } from '../../../../shared/i18n.js';

const PRICE_COLORS = { normal: '#FFC600', discount: '#59F4CA', premium: '#FF5454', grey: '#C0C5C3' };

const FRAME_FILE = {
  normal: 'sprites/chess_frame_normal.webp',
  level_five: 'sprites/chess_frame_level_five.webp',
  level_six: 'sprites/chess_frame_level_six.webp',
};

const TIER_FILE = (tier) => `sprites/chess_level_icon_${tier}.webp`;

/**
 * Armed confirm-strip copy, the DOM rule: shopBar.js ArmedTag (lines 133–135) writes 确认选择 when the card is
 * `free` and 确认购买 otherwise, and only RewardCards (shopBar.js ~485) passes `free: true` — a normal slot whose
 * price a discount brings to 0 still says 确认购买. The canvas reward row (ShopCanvas.js shopRewardRow) writes
 * price 0 AND basePrice 0, so cardModelFromSlot gives its cards `srcPrice` 0, while a discounted normal card keeps
 * its original price there.
 * @param {{ price?: unknown, srcPrice?: unknown }|null|undefined} model the card's shopModel()
 * @returns {string}
 */
export function confirmStripLabel(model) {
  if (!model) return t('确认购买');
  const free = (Number(model && model.price) || 0) === 0 && (Number(model && model.srcPrice) || 0) === 0;
  return free ? t('确认选择') : t('确认购买');
}

const clone = cloneNode;

/** Re-path a cloned card sub-prefab subtree (same rule as ctrl.js:12-17). */
export function repathCardNode(node, basePath, name = node.name) {
  if (!node) return node;
  node.name = name;
  node.path = basePath ? `${basePath}/${name}` : name;
  for (const child of node.children || []) repathCardNode(child, node.path);
  return node;
}

function findNode(root, name) {
  if (!root) return null;
  if (root.name === name) return root;
  for (const child of root.children || []) {
    const hit = findNode(child, name);
    if (hit) return hit;
  }
  return null;
}

/**
 * The effective loop length. These legacy clips carry m_MuscleClip.m_StopTime = 1.0 in the bundle even
 * when their keys run past it (card_prefab.py records both len/key-end and stopTime); the official
 * Animation plays the stop time. `len` remains the key-frame end the extractor also records; no clip curve is
 * rewritten.
 * @param {{ len?: number, stopTime?: number }|null|undefined} clip
 * @returns {number}
 */
export function tripleLoopLength(clip) {
  const stop = Number(clip && clip.stopTime);
  if (Number.isFinite(stop) && stop > 0) return stop;
  return Number(clip && clip.len) || 0;
}

/**
 * The repeated-card loop entry the scene plays: the official AnimationWrapper loops loop_triple from the card
 * clock, and a still frame keeps the clip's pinned stop time (tripleLoopLength), not its key-frame end.
 * @param {{ still?: boolean }} state
 * @param {{ len?: number, stopTime?: number, curves?: any[] }|null|undefined} clip
 * @param {string} basePath
 */
export function tripleLoopEntry(state, clip, basePath) {
  const len = tripleLoopLength(clip);
  const still = !!(state && state.still);
  const pin = len;
  return {
    clipName: 'loop_triple',
    t: still ? pin : 0,
    clock: true,
    len,
    stillT: still ? pin : null,
    basePath,
  };
}

/**
 * Whether a drawn card may be bought: an empty/sold card and a full hand cannot (the server refuses with
 * HAND_FULL, GitHub #82). Pure, so the state derivation is testable without a scene.
 * @param {{ isEmpty?: boolean, isHandFull?: boolean }} model
 * @returns {boolean}
 */
export function cardAble(model) {
  return !model.isEmpty && !model.isHandFull;
}

export class AutoChessBattleShopCardView {

  constructor({ scene, root, model, index }) {
    this.scene = scene;
    this.doc = scene.cardDoc;
    this.root = root;
    this.model = model;
    this.index = index;

    this.state = null;

    this.ui = { phase: 'NONE' };

    this.library = [];
    this.twoPhase = new TwoPhaseButtonWidget({
      onFirstClick: () => this.EventOnFirstClick(),
      onConfirm: () => this.EventOnConfirm(),
    });
  }

  levelStyle(tier) {
    const levels = this.doc.driver.levels || [];
    return levels.find((l) => (l.tiers || []).includes(tier)) || levels[0] || {};
  }

  pieceOf() {
    return this.model || {};
  }

  operatorName() {
    return (this.model && this.model.name) || '';
  }

  shopModel() {
    const price = Number(this.model && this.model.price != null ? this.model.price : 0);
    // state.coin is the product path: adapter/model.js currCoin always exists. The fallback serves hand-built
    // fixtures: an able card looks affordable, an unable one one coin short so the cost row draws grey.
    const coin = this.state.coin != null ? Number(this.state.coin) : (this.state.able ? price : Math.max(0, price - 1));
    const srcPrice = this.state.srcPrice != null ? Number(this.state.srcPrice) : (Number(this.model && this.model.srcPrice) || price);
    return {
      price,
      coin,
      srcPrice,
      handFull: !!this.state.handFull,
      // `locked` (the seat may not buy at all, e.g. ROUND_START / 准备 pressed) draws the same unbuyable matte as
      // an unaffordable card; the click itself is refused by the caller (ShopCanvas.tapCard).
      enough: coin >= price && !this.state.handFull && !this.state.locked,
      priceNormal: price <= coin,
    };
  }

  priceColorFor(model) {
    if (model.price === model.srcPrice) return PRICE_COLORS.normal;
    return model.price < model.srcPrice ? PRICE_COLORS.discount : PRICE_COLORS.premium;
  }

  uniqueEmitterPaths(subRoot, subDoc, prefix) {
    if (!subRoot || !subDoc) return subRoot;
    const names = new Set((subDoc.particles || []).map((spec) => String(spec.path || '').split('/').pop()));
    if (!names.size) return subRoot;
    (function walk(node) {
      if (!node) return;
      if (names.has(node.name)) node.path = `${prefix}/${node.path || node.name}`;
      for (const child of node.children || []) walk(child);
    })(subRoot);
    return subRoot;
  }

  buildTree() {
    const tree = this.root;
    const level = this.levelStyle(this.state.tier);
    const sub = (name) => (name && this.doc.sub && this.doc.sub[name] ? clone(this.doc.sub[name].root) : null);
    const frameHost = findNode(tree, 'frame_obj_container');
    const tierHost = findNode(tree, 'chess_level_obj_container');
    const frameSub = sub(level.frame);
    const tierSub = sub(level.tierObj);
    if (frameHost && frameSub) frameHost.children = [...(frameHost.children || []), this.uniqueEmitterPaths(repathCardNode(frameSub, frameHost.path), this.doc.sub[level.frame], tree.path)];
    if (tierHost && tierSub) tierHost.children = [...(tierHost.children || []), this.uniqueEmitterPaths(repathCardNode(tierSub, tierHost.path), this.doc.sub[level.tierObj], tree.path)];
    return tree;
  }

  applyState(tree) {
    const state = this.state;
    const setNodeActive = (name, active) => { const n = findNode(tree, name); if (n) n.active = !!active; };
    setNodeActive('group_char', true);
    setNodeActive('group_equip', false);
    setNodeActive('equip', false);
    setNodeActive('state_empty', false);
    setNodeActive('state_fx_frozen', state.frozen);
    setNodeActive('state_fx_triple', state.repeated);
    this.applyShopState(tree);
    this.applyStripText(tree);
    this.applyChessLevelStyle(tree);

    const model = this.model || {};
    const portrait = findNode(tree, 'char_portrait');
    if (portrait) {
      portrait.image = { type: 'simple', color: '#FFFFFF', file: model.portraitFile || null };
      portrait.image.w = 180;
      portrait.image.h = 360;
    }
    const name = findNode(tree, 'char_name');

    if (name) name.text = { ...(name.text || {}), text: this.operatorName(), color: model.nameColor || name.text.color };

    const prof = findNode(tree, 'prof_icon');
    if (prof) {
      const profession = String(model.profession || '').toLowerCase();
      prof.active = !!profession;
      if (profession) prof.image = { ...(prof.image || {}), file: model.profMarkFile || null };
    }

    const diffTag = findNode(tree, 'square_fx');
    if (diffTag) diffTag.active = model.difficulty != null || model.diff != null;
    const garrison = findNode(tree, 'garrison_icon');
    if (garrison) {
      const icon = model.garrisonIconFile || null;
      garrison.active = !!icon;
      if (icon) garrison.image = { ...(garrison.image || {}), file: icon, color: model.garrisonTint || '#FFFFFF' };
    }
    if (state.bonds) this.applyBonds(tree);
    this.applyCost(tree);
    return tree;
  }

  applyChessLevelStyle(tree) {
    const state = this.state;
    const level = this.levelStyle(state.tier);
    const urlOf = this.model && this.model.urlOf;
    const tierImg = findNode(tree, 'img_chess_level');
    if (tierImg) tierImg.image = { type: 'simple', color: '#FFFFFF', file: urlOf ? urlOf(TIER_FILE(state.tier)) : null, sprite: `chess_level_icon_${state.tier}` };
    const frameImg = findNode(tree, 'frame');
    if (frameImg) frameImg.image = { type: 'simple', color: '#FFFFFF', file: urlOf ? urlOf(FRAME_FILE[level.frameKey]) : null, sprite: `chess_frame_${level.frameKey}` };
    const deco = findNode(tree, 'deco_front');
    if (deco) deco.image = { ...(deco.image || {}), color: level.decoColor || '#FFFFFF' };
  }

  applyStripText(tree) {
    // shopBar.js ArmedTag (lines 133–135): a reward card (free) says 确认选择, any other card 确认购买.
    // group_disable stays 无法购买, which is ArmedTag's reason branch.
    const able = confirmStripLabel(this.shopModel());
    for (const [group, value] of [['group_able', able], ['group_disable', t('无法购买')]]) {
      const holder = findNode(tree, group);
      const stripText = holder && findNode(holder, 'text');
      if (stripText) stripText.text = { ...(stripText.text || {}), text: value };
    }
  }

  applyBonds(tree) {
    const list = findNode(tree, 'bond_list');
    const bondItem = this.doc.sub && this.doc.sub.bond_item;
    const bonds = (this.model && this.model.bondList) || [];
    if (!list) return;
    // The card root is reused across renders (slots.js keeps it while slotId/kind stay put), and bond_list is not
    // one of the mount bases resetMounts restores: a record without bonds must drop the previous card's rows.
    list.children = [];
    if (!bondItem || !bonds.length) return;
    const template = clone(bondItem.root);
    const rowH = (template.rect && template.rect.sizeDelta && template.rect.sizeDelta[1]) || 18;
    const rowW = (template.rect && template.rect.sizeDelta && template.rect.sizeDelta[0]) || 154;

    const containerH = (list.rect && list.rect.sizeDelta && list.rect.sizeDelta[1]) || 58;
    const blockH = bonds.length * rowH;
    const startY = Math.max(0, containerH - blockH);
    list.children = bonds.map((bond, index) => {
      const row = repathCardNode(clone(template), list.path, `${template.name}_${index}`);
      row.rect = { anchors: { min: [0, 1], max: [0, 1] }, pivot: [0, 1], sizeDelta: [rowW, rowH], anchoredPosition: [4, -(startY + index * rowH)] };
      const icon = findNode(row, 'icon');

      if (icon) icon.image = { ...(icon.image || {}), file: bond.iconFile || null, sprite: bond.iconId };
      const txt = findNode(row, 'txt');
      if (txt) txt.text = { ...(txt.text || {}), text: bond.name, color: (this.model && this.model.bondColor) || '#000000' };
      return row;
    });
  }

  applyCost(tree) {
    const holder = findNode(tree, 'root_cost');
    const source = this.doc.sub && this.doc.sub.cost_view;
    if (!holder || !source) return;
    const costRoot = repathCardNode(clone(source.root), holder.path, source.root.name);
    holder.children = [costRoot];
    this.applyCostState(costRoot, this.shopModel());
  }

  applyShopState(tree) {
    const model = this.shopModel();
    const strip = this.ui.phase !== 'NONE';
    const setNodeActive = (name, active) => { const n = findNode(tree, name); if (n) n.active = !!active; };

    setNodeActive('disable_matte', !model.enough);

    setNodeActive('btn_double_check', strip);
    setNodeActive('group_able', strip && model.enough);
    setNodeActive('group_disable', strip && !model.enough);
    const costRoot = findNode(tree, 'autochess_shop_cost_item') || findNode(tree, 'root_normal');
    if (costRoot) this.applyCostState(costRoot, model);
  }

  applyCostState(costRoot, model) {
    const normal = findNode(costRoot, 'root_normal');
    const grey = findNode(costRoot, 'root_grey');

    if (normal) normal.active = model.priceNormal;
    if (grey) grey.active = !model.priceNormal;
    const normalText = normal && findNode(normal, 'text_num');
    if (normalText) normalText.text = { ...(normalText.text || {}), text: String(model.price), color: this.priceColorFor(model) };
    const greyText = grey && findNode(grey, 'text_num');
    if (greyText) greyText.text = { ...(greyText.text || {}), text: String(model.price), color: PRICE_COLORS.grey };
  }

  renderEquip(tree) {
    const equipIcon = findNode(tree, 'equip');
    // A card view is reused when a chess slot becomes an item slot (the reward row puts offer items
    // where the normal row had operators): the chess render switched `equip` off, so an item render must
    // switch it back on or the image below is uploaded but never drawn.
    if (equipIcon) equipIcon.active = true;
    if (equipIcon && this.model.iconFile) {
      equipIcon.image = { ...(equipIcon.image || {}), file: this.model.iconFile, sprite: this.model.icon };
    }
    const equipName = findNode(tree, 'eqiup_name');
    if (equipName) {
      equipName.text = {
        ...(equipName.text || {}),
        text: this.model.name || '',
        color: (this.model && this.model.nameColor) || (equipName.text && equipName.text.color),
      };
    }
    return tree;
  }

  stateOf(model) {
    return {
      tier: Number(model.tier) || 1,

      // A sold/empty card and a full hand cannot be bought (server HAND_FULL, GitHub #82): the model carries
      // both, so the card view derives the flag instead of assuming every drawn card is purchasable. A locked
      // seat (not editable) is the third: the panel still shows the row, but no card is buyable.
      able: cardAble(model) && !model.isLocked,
      coin: model.currCoin != null ? Number(model.currCoin) : null,
      handFull: !!model.isHandFull,
      locked: !!model.isLocked,
      srcPrice: model.srcPrice != null ? Number(model.srcPrice) : null,
      frozen: !!model.isFrozen,

      // card_prefab.py rules.repeatedFxNode: (canComb && hasSame) || hasFusePartner; slots.js draws the same test.
      repeated: !!(model.hasFusePartner || (model.canComb && model.hasSame)),
      armed: !!model.armed,

      // true records the settled pose: every clip entry below carries t / stillT at the end pose. scene.js replays
      // stillT only on a still frame and otherwise advances the same clip from its own card clock.
      still: true,
      bonds: model.bonds !== false,
      operator: String(model.id || ''),
    };
  }

  stateUi(model) {
    return { phase: model.armed ? 'CLICKABLE' : 'NONE' };
  }

  RenderView(context = {}) {
    const model = context.model || this.model;
    if (context.model) this.model = model;
    const empty = findNode(this.root, 'state_empty');
    const panel = findNode(this.root, 'panel_main');
    const anyEmpty = !!model.isEmpty;
    setActive(empty, anyEmpty);
    setActive(panel, !anyEmpty);
    this.twoPhase.Reset();
    this.root.__clips = [];
    if (anyEmpty) return this;

    this.state = this.stateOf(model);
    this.library = [{ id: this.state.operator, name: model.name }];
    this.ui = this.stateUi(model);
    // Only the tier's mounted sub-prefabs may own a tv_particle: CardParticles draws a system only where its
    // prefab is mounted per slot.
    const level = this.levelStyle(this.state.tier);
    this.mounted = [level.frame, level.tierObj].filter(Boolean);
    if (this.root) this.root.__cardMounted = this.mounted;

    const tree = this.buildTree();
    if (model.isChar) {
      this.applyState(tree);
    } else {

      setActive(findNode(tree, 'group_char'), false);
      setActive(findNode(tree, 'group_equip'), true);

      setActive(findNode(tree, 'state_fx_frozen'), this.state.frozen);
      setActive(findNode(tree, 'state_fx_triple'), this.state.repeated);
      this.applyStripText(tree);
      this.applyShopState(tree);
      this.applyCost(tree);
      this.applyChessLevelStyle(tree);
      this.renderEquip(tree);
    }
    this.collectClips();
    return this;
  }

  armClock() {
    const at = Number(this.model.armedAt);
    if (!Number.isFinite(at)) return 0;
    return Math.max(0, (performance.now() - at) / 1000);
  }

  collectClips() {
    const state = this.state;
    const clips = this.doc.clips || {};
    const basePath = (name) => { const node = findNode(this.root, name); return node ? (node.path || name) : ''; };
    const entries = [];

    if (state.frozen && clips.card_frozen) {
      entries.push({ clipName: 'card_frozen', t: state.still ? Number(clips.card_frozen.len) || 0 : 0, basePath: basePath('state_fx_frozen') });
    }

    if (state.repeated && clips.loop_triple) {
      entries.push(tripleLoopEntry(state, clips.loop_triple, basePath('state_fx_triple')));
    }

    if (this.ui.phase !== 'NONE' && clips.btn_double_check) {
      const len = Number(clips.btn_double_check.len) || 0;
      entries.push({ clipName: 'btn_double_check', t: state.still ? len : Math.min(this.armClock(), len), basePath: basePath('btn_double_check') });
    }

    const level = this.levelStyle(state.tier);
    for (const name of [level.frame, level.tierObj]) {
      const subDoc = name && this.doc.sub && this.doc.sub[name];
      if (!subDoc) continue;
      const node = findNode(this.root, name);
      const subBasePath = node ? (node.path || name) : name;
      for (const [clipName, clip] of Object.entries(subDoc.clips || {})) {
        if (!/^loop_tier_star_lv(5|6)$/.test(clipName)) continue;
        const len = Number(clip.len) || 0;
        if (!(len > 0)) continue;
        entries.push({ clipName, t: 0, clock: true, len, basePath: subBasePath, sub: name, hermite: false });
      }
    }
    this.root.__clips = entries;
  }

  PlayRefreshAnim() {
    const clip = (this.doc.clips || {}).single_card_refresh || {};
    this.root.__clips = (this.root.__clips || []).filter((c) => c.clipName !== 'single_card_refresh');
    this.root.__clips.push({ clipName: 'single_card_refresh', t: Number(clip.len) || 0.2333, basePath: this.root.path });
  }

  EventOnFirstClick() {
    return { message: 106, slotId: this.model.slotId };
  }

  EventOnConfirm() {
    return { message: 105, slotId: this.model.slotId };
  }
}
