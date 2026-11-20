

import { twoStateToggleOf, threeStateToggleOf, ShopCostView } from './widgets.js';
import { setText, setActive, scriptsOf, resolveScriptRefs, cloneNode, findPath } from './prefab.js';
import { t } from '../../../../shared/i18n.js';

function repath(node, basePath, name = node.name) {
  node.name = name;
  node.path = basePath ? `${basePath}/${name}` : name;
  for (const child of node.children || []) repath(child, node.path);
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
    this.costView = null;
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
    const canRefresh = data.isSpecialRecruit || data.freeRefreshCnt > 0 || data.coinCount >= data.refreshCost;

    this.canRefresh = !!canRefresh;
    if (this.enableToggle) this.enableToggle.set_selected(canRefresh);
    if (this.freeToggle) this.freeToggle.set_selected(data.freeRefreshCnt > 0);
    this._renderRefreshCost(data);

    setText(this.refs._freeCnt, String(Math.max(0, Number(data.freeRefreshCnt) || 0)));
    if (this.specToggle) this.specToggle.set_selected(data.isSpecRefresh);

    if (this.freezeToggle) {
      const state = data.isSpecialRecruit ? 0 : (data.isFrozen ? 2 : 1);
      this.freezeToggle.set_state(state);
    }

    setText(findPath(this.root, 'btn_refresh/group_normal/text'), t('刷新'));
    setText(findPath(this.root, 'btn_refresh/group_lock/text'), t('刷新'));
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
