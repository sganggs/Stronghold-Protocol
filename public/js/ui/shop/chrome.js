








import { ShopDisplayStatus } from './model.js';
import { TwoStateToggle, AutoChessShopLevelView, ShopMoneyView, UIBiAnimClipSwitchTween } from './widgets.js';
import { scriptsOf, resolveScriptRefs, cloneNode, findPath, setActive, setText } from './prefab.js';
import { t } from '../../../../shared/i18n.js';


function repath(node, basePath, name = node.name) {
  node.name = name;
  node.path = basePath ? `${basePath}/${name}` : name;
  for (const child of node.children || []) repath(child, node.path);
  return node;
}

export class AutoChessStylizedShopChromePanel {
  
  constructor({ scene, root, components }) {
    this.scene = scene;
    this.root = root;
    this.index = scene.index;
    this.comps = components;
    const chrome = scriptsOf(root, 'AutoChessStylizedShopChromePanel')[0];
    if (!chrome) throw new Error('panel_shop_main: AutoChessStylizedShopChromePanel component not found');
    this.refs = resolveScriptRefs(chrome, this.index).refs;
    this.anims = resolveScriptRefs(chrome, this.index).anims;


    const toggle = scriptsOf(root, 'TwoStateToggle')[0];
    const toggleRefs = toggle ? resolveScriptRefs(toggle, this.index).refs : {};
    this.enableToggle = new TwoStateToggle({ unselect: toggleRefs._unselect, select: toggleRefs._select });

    const level = scriptsOf(root, 'AutoChessShopLevelView')[0];


    this.levelView = new AutoChessShopLevelView({
      images: level ? resolveScriptRefs(level, this.index).refs._levelImages : [],
      spritePrefix: 'lv',
    });

    this.status = ShopDisplayStatus.NONE;
    this.moneyView = null;
    this.moneyRoot = null;
    
    this.foldShow = true;





    const loc = (anim) => (anim && anim.clip
      ? { name: anim.clip, basePath: root.path, doc: scene.panelDoc }
      : null);
    this.foldSwitchTween = new UIBiAnimClipSwitchTween({
      scene,
      key: 'chrome',
      clipOn: loc(this.anims && this.anims._unfoldAnim),
      clipOff: loc(this.anims && this.anims._foldAnim),
    });
    this.foldSwitchTween.Reset(false);
  }

  
  initMoney() {
    if (this.moneyView || !this.refs._moneyHolder) return;
    const doc = this.scene.moneyDoc;
    const holder = this.refs._moneyHolder;
    const money = cloneNode(doc.root);
    repath(money, holder.path, money.name);
    holder.children = [money];
    this.scene.moneyRoot = money;
    this.moneyView = new ShopMoneyView({ root: money });
  }

  
  calcShopDisplayStatus(data) {
    if (!data.isAvailable) return ShopDisplayStatus.DISABLE;
    return data.isUnfold ? ShopDisplayStatus.UNFOLD : ShopDisplayStatus.FOLD;
  }

  
  _renderShopStatus(status) {
    this.status = status;
    this.foldShow = status === ShopDisplayStatus.UNFOLD;

    if (status === ShopDisplayStatus.DISABLE) this.foldSwitchTween.Reset(false);


    const statusClip = status === ShopDisplayStatus.FOLD ? 'shop_fold'
      : (status === ShopDisplayStatus.UNFOLD ? 'shop_unfold' : 'shop_disable');
    const clip = (this.scene.panelDoc.clips || {})[statusClip];
    if (clip) {
      this.scene.setSettle('chrome', {
        doc: this.scene.panelDoc,
        clipName: statusClip,
        t: Number(clip.len) || 0,
        basePath: this.root.path,
      });
    }
    const able = findPath(this.root, 'state_able');
    const unfold = findPath(this.root, 'state_unfold');
    const disable = findPath(this.root, 'state_disable');
    setActive(able, status === ShopDisplayStatus.FOLD);
    setActive(unfold, status === ShopDisplayStatus.UNFOLD);
    setActive(disable, status === ShopDisplayStatus.DISABLE);
  }

  
  playFold(show, force = true) {
    this.foldSwitchTween.set_isShow(!!show, force);
  }

  
  Render(data) {
    this.initMoney();

    this.enableToggle.set_selected(data.isAvailable);
    setActive(this.refs._btnCloseObj, data.isAvailable);

    if (this.moneyView) this.moneyView.Render(data.coinCount, data.isGoldCountUp);

    this.levelView.Render(data.level, data.skinId, false);


    setText(this.refs._charRemainNum, String(Number(data.remainCharCnt) || 0));
    const remainPrefix = findPath(this.root, 'panel_remaining_available_character/text_prefix');
    setText(remainPrefix, t('剩余可放置角色：'));

    const status = this.calcShopDisplayStatus(data);
    if (status !== this.status) this._renderShopStatus(status);

    const unfolded = status === ShopDisplayStatus.UNFOLD;
    setText(findPath(this.root, 'btn_close/text'), unfolded ? t('收起') : t('展开'));
    const arrow = findPath(this.root, 'btn_close/open_arrow');
    if (arrow) arrow.rot = unfolded ? 0 : 180;


    const rootText = findPath(this.root, 'root_text_unfold');
    if (rootText) {
      const wasActive = rootText.active !== false;
      setActive(rootText, !unfolded);
      if (wasActive !== !unfolded) this.scene.markDirty('layout');
    }
    const unfoldLabel = findPath(this.root, 'root_text_unfold/root_layout/text_unfold');
    if (unfoldLabel) {
      const next = unfolded ? t('收起') : t('展开');
      const prev = unfoldLabel.text && unfoldLabel.text.text;
      setText(unfoldLabel, next);
      if (prev !== next) this.scene.markDirty('layout');
    }
    const unfoldArrow = findPath(this.root, 'root_text_unfold/root_layout/open_arrow');
    if (unfoldArrow) unfoldArrow.rot = unfolded ? 0 : 180;

    const spine = this.refs._foldSpineGraphic;
    if (spine && spine.image) {
      spine.image = { ...spine.image, color: data.isAvailable ? (spine.image.color || '#FFFFFF') : '#808080FF' };
    }
    return this;
  }

  
  EventOnEnabledClick() {
    return { message: 101, isOpen: true };
  }

  
  EventOnUnfoldClick() {
    return { message: 101, isOpen: false };
  }

  
  EventOnDisabledClick() {
    return { toast: 'AUTO_CHESS_SHOP_DISABLE_TIPS' };
  }
}
