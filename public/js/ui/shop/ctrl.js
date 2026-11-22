

import { twoStateToggleOf, threeStateToggleOf, ShopCostView } from './widgets.js';
import { setText, scriptsOf, resolveScriptRefs, cloneNode, findPath } from './prefab.js';
import { t } from '../../../../shared/i18n.js';

function repath(node, basePath, name = node.name) {
  node.name = name;
  node.path = basePath ? `${basePath}/${name}` : name;
  for (const child of node.children || []) repath(child, node.path);
  return node;
}

/**
 * Whether the painted refresh button is usable. The caller's own block reason (ShopCanvas's
 * shopBlockReason('refresh'), the same value the hotspot is disabled with) wins when it is published: a special
 * recruit does not make a refresh free — a free refresh arrives as refreshCost 0 — and a ready / non-editable
 * seat is refused. The cost-only fallback serves the dev page and old callers, which publish no gate.
 * @param {any} data CtrlViewData-shaped (`refreshBlocked`, `freeRefreshCnt`, `coinCount`, `refreshCost`)
 * @returns {boolean}
 */
export function canRefreshOf(data) {
  if (!data) return false;
  if (data.refreshBlocked != null) return !data.refreshBlocked;
  return Number(data.freeRefreshCnt) > 0 || Number(data.coinCount) >= Number(data.refreshCost);
}

/** The freeze toggle's state: frozen wins so a ready-blocked frozen shop still shows 解冻. */
export function freezeState(data) {
  return data && data.isFrozen ? 2 : (data && data.freezeBlocked ? 0 : 1);
}

/**
 * The reward control on the left of freeze/refresh: a clone of the refresh button with its icon nodes
 * removed (the button is text-only and centred), the refresh background, and the refresh cost holder
 * reused for the queued count. This keeps the prefab's pill, glow, font and badge shape.
 */
export function buildRewardButtonNode(template, rootPath) {
  const node = cloneNode(template);
  repath(node, rootPath, 'btn_reward');
  // The refresh/freeze sprites carry transparent side margins: -391 puts the reward pill's
  // solid edge 4 units from freeze, matching the 4-unit freeze/refresh visual gap.
  node.rect = { ...(node.rect || {}), sizeDelta: [168, 76], anchoredPosition: [-391, 0] };
  node.active = true;
  node.children = (node.children || []).filter((child) => child.name !== 'group_lock');

  const normal = findPath(node, 'group_normal');
  if (normal) {
    normal.children = (normal.children || []).filter((child) => child.name === 'bg' || child.name === 'text');
    const text = findPath(normal, 'text');
    if (text) {
      text.rect = { ...(text.rect || {}), sizeDelta: [120, 26], anchoredPosition: [0, 2] };
      // Match the refresh label: same 19px NotoSansHans face and #1F1F1F fill.
      text.text = { ...(text.text || {}), bestFit: true, fontSize: 19, minSize: 1, maxSize: 19, color: '#1F1F1F' };
    }
  }

  const cost = findPath(node, 'root_cost');
  if (cost) {
    cost.children = (cost.children || []).filter((child) => child.name === 'group_free');
    const free = findPath(cost, 'group_free');
    if (free) {
      free.active = true;
      const bg = findPath(free, 'bg');
      if (bg) {
        bg.image = { ...(bg.image || {}), type: 'simple', sprite: 'cost_bg_1', file: 'sprites/cost_bg_1.webp', w: 44, h: 36, color: '#FFFFFF' };
        bg.rect = { ...(bg.rect || {}), sizeDelta: [44, 36], anchoredPosition: [0, -1] };
      }
      const num = findPath(free, 'text_num');
      if (num) {
        num.text = { ...(num.text || {}), text: '', font: 'Novecentowide-Medium', fontSize: 20, minSize: 1, maxSize: 20, color: '#FFC600', align: 4, bestFit: true };
        num.rect = { ...(num.rect || {}), anchoredPosition: [0, 4] };
      }
    }
  }
  return node;
}

export class AutoChessStylizedShopCtrlPanel {

  constructor({ scene, root }) {
    this.scene = scene;
    this.root = root;
    this.index = scene.index;
    const entry = scriptsOf(root, 'AutoChessStylizedShopCtrlPanel')[0];
    if (!entry) throw new Error('panel_ctrl_btn: AutoChessStylizedShopCtrlPanel component not found');
    this.refs = resolveScriptRefs(entry, this.index).refs;

    this.enableToggle = twoStateToggleOf(this.refs._enableToggle, this.index);

    this.freeToggle = twoStateToggleOf(this.refs._freeToggle, this.index);

    this.specToggle = twoStateToggleOf(this.refs._specToggle, this.index);

    this.freezeToggle = threeStateToggleOf(this.refs._freezeToggle, this.index);
    this.rewardButton = this.buildRewardButton();
    this.costView = null;
  }

  /** Append the reward pill to the panel once; Render only updates it, so a repeated call returns the same node. */
  buildRewardButton() {
    if (this.rewardButton) return this.rewardButton;
    const template = findPath(this.root, 'btn_refresh');
    if (!template) return null;
    const node = buildRewardButtonNode(template, this.root.path);
    this.root.children = [...(this.root.children || []), node];
    return node;
  }

  initCost() {
    if (this.costView || !this.refs._refreshCostHolder) return;
    const costDoc = this.scene.cardDoc && this.scene.cardDoc.sub && this.scene.cardDoc.sub.cost_view;
    if (!costDoc || !costDoc.root) return;
    const holder = this.refs._refreshCostHolder;
    const cost = cloneNode(costDoc.root);
    repath(cost, holder.path, 'cost');
    holder.children = [cost];
    this.costView = new ShopCostView({ root: cost });
  }

  _renderRefreshCost(data) {
    if (!this.costView) this.initCost();

    if (this.costView) this.costView.Render(data.refreshCost, data.coinCount);
  }

  Render(data) {
    this.initCost();
    // The caller's shopBlockReason('refresh') reason is authoritative when it is published (the same reason the
    // hotspot is disabled with); the cost-only fallback serves the dev page and old callers — see canRefreshOf.
    const canRefresh = canRefreshOf(data);

    this.canRefresh = !!canRefresh;
    if (this.enableToggle) this.enableToggle.set_selected(canRefresh, true);
    if (this.freeToggle) this.freeToggle.set_selected(data.freeRefreshCnt > 0);
    this._renderRefreshCost(data);

    setText(this.refs._freeCnt, String(Math.max(0, Number(data.freeRefreshCnt) || 0)));
    if (this.specToggle) this.specToggle.set_selected(data.isSpecRefresh);

    if (this.freezeToggle) {
      this.freezeToggle.set_state(freezeState(data));
    }

    setText(findPath(this.root, 'btn_refresh/group_normal/text'), t('刷新'));
    setText(findPath(this.root, 'btn_refresh/group_lock/text'), t('刷新'));

    if (this.rewardButton) {
      const reward = data.reward;
      this.rewardButton.active = !!reward;
      if (reward) {
        const label = reward.label || (reward.visible ? t('稍后') : t('选择奖励'));
        setText(findPath(this.rewardButton, 'group_normal/text'), label);
        setText(findPath(this.rewardButton, 'root_cost/group_free/text_num'), `x${Math.max(1, Number(reward.count) || 1)}`);
      }
    }
    const freezeLock = findPath(this.root, 'btn_frozen/group_lock/text');
    setText(freezeLock, t('冻结'));
    const freezeUnlock = findPath(this.root, 'btn_frozen/group_unlock/text');
    setText(freezeUnlock, t('解冻'));
    const freezeDisable = findPath(this.root, 'btn_frozen/group_disable/text');
    setText(freezeDisable, t('冻结'));
    return this;
  }

  EventOnRefresh() {
    return { message: 102 };
  }

  EventOnFreeze() {
    return { message: 103 };
  }

  get refreshHotspot() {
    return this.refs._btnRefresh || null;
  }

  get freezeHotspot() {
    return findPath(this.root, 'btn_frozen/hotspot');
  }
}
