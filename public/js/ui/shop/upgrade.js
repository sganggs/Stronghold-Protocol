








import { threeStateToggleOf, TwoPhaseButtonWidget, AutoChessShopLevelView, ShopCostView, TwoStateBiAnimationSwitcher, UIBiAnimClipSwitchTween } from './widgets.js';
import { scriptsOf, resolveScriptRefs, cloneNode, findPath, setActive, setText } from './prefab.js';
import { ThreeStateToggleState } from './model.js';
import { t } from '../../../../shared/i18n.js';

function repath(node, basePath, name = node.name) {
  node.name = name;
  node.path = basePath ? `${basePath}/${name}` : name;
  for (const child of node.children || []) repath(child, node.path);
  return node;
}

export class AutoChessStylizedShopUpgradePanel {
  
  constructor({ scene, root }) {
    this.scene = scene;
    this.root = root;
    this.index = scene.index;
    const entry = scriptsOf(root, 'AutoChessStylizedShopUpgradePanel')[0];
    if (!entry) throw new Error('group_upgrade: AutoChessStylizedShopUpgradePanel component not found');
    this.refs = resolveScriptRefs(entry, this.index).refs;
    this.anims = resolveScriptRefs(entry, this.index).anims;
    this.stageToggle = threeStateToggleOf(root, this.index);

    const levels = scriptsOf(root, 'AutoChessShopLevelView');



    this.curLevelView = new AutoChessShopLevelView({
      images: levels[0] ? resolveScriptRefs(levels[0], this.index).refs._levelImages : [], spritePrefix: 'upgrade_lv',
    });
    this.nextLevelView = new AutoChessShopLevelView({
      images: levels[1] ? resolveScriptRefs(levels[1], this.index).refs._levelImages : [], spritePrefix: 'upgrade_lv',
    });

    const normal = findPath(root, 'group_normal');
    const switcher = normal ? scriptsOf(normal, 'TwoStateBiAnimationSwitcher')[0] : null;
    const switcherRefs = switcher ? resolveScriptRefs(switcher, this.index) : null;
    this.confirmSwitcher = switcherRefs
      ? new TwoStateBiAnimationSwitcher({ anims: switcherRefs.anims })
      : null;


    const anims = (switcherRefs && switcherRefs.anims) || {};
    const inName = (anims._animSelect && anims._animSelect.clip) || 'btn_upgrade_doublecheck_in';
    const outName = (anims._animUnselect && anims._animUnselect.clip) || 'btn_upgrade_doublecheck_out';
    this.confirmTween = normal ? new UIBiAnimClipSwitchTween({
      scene,
      key: 'upgrade-confirm',
      clipOn: { name: inName, basePath: normal.path, doc: scene.panelDoc },
      clipOff: { name: outName, basePath: normal.path, doc: scene.panelDoc },
    }) : null;
    this.confirmBasePath = normal ? normal.path : null;
    this.confirmClips = { inName, outName };
    if (this.confirmTween) {
      this.confirmTween.onAfterShow = () => this._settleConfirm(true);
      this.confirmTween.onAfterHide = () => this._settleConfirm(false);
    }



    const doubleText = findPath(root, 'group_normal/text_double_check');
    if (doubleText && doubleText.text) doubleText.text = { ...doubleText.text, color: '#FFFFFFFF' };
    this.btnClick = new TwoPhaseButtonWidget({
      onFirstClick: () => this.EventOnFirstClick(),
      onConfirm: () => this.EventOnUpgrade(),
      switcher: this.confirmTween ? { set_isShow: (show) => this.confirmTween.set_isShow(!!show) } : null,
    });
    this.costView = null;
    this.upgradeCurrLevel = -1;
    this.upgradePlaying = 0;
  }

  
  initCost() {
    if (this.costView || !this.refs._costHolder) return;
    const costDoc = this.scene.cardDoc && this.scene.cardDoc.sub && this.scene.cardDoc.sub.cost_view;
    if (!costDoc || !costDoc.root) return;
    const holder = this.refs._costHolder;
    const cost = cloneNode(costDoc.root);
    repath(cost, holder.path, 'cost');
    holder.children = [cost];
    this.costView = new ShopCostView({ root: cost });
  }

  
  renderShopLevel(data) {
    this.curLevelView.Render(data.level, data.skinId, true);
    if (data.level < data.maxLevel) this.nextLevelView.Render(data.level + 1, data.skinId, true);
  }

  
  renderCost(data) {
    if (!this.costView) this.initCost();
    if (!this.costView) return;
    this.costView.Render(data.upgradeCost, data.coinCount);
    this.costView.SetPriceColor(data.upgradeCostColor);
  }

  
  renderUpgradeState(data) {
    const maxed = data.level >= data.maxLevel;
    const affordable = data.coinCount >= data.upgradeCost;
    if (this.stageToggle) {
      this.stageToggle.set_state(maxed
        ? ThreeStateToggleState.SECOND_SELECT
        : (affordable ? ThreeStateToggleState.FIRST_SELECT : ThreeStateToggleState.UNSELECT));

      if (this.scene && this.scene.refreshActiveBase) {
        this.scene.refreshActiveBase(this.stageToggle.unselect);
        this.scene.refreshActiveBase(this.stageToggle.firstSelect);
        this.scene.refreshActiveBase(this.stageToggle.secondSelect);
      }
    }
    this.renderCost(data);

    setActive(this.refs._costHolder, !maxed);

    if (data.level > this.upgradeCurrLevel && this.upgradeCurrLevel > 0) this.playUpgradeAnim();
    this.upgradeCurrLevel = data.level;


    const slot = data.selectSlot;
    const upgrading = !!(slot && slot.isUpgrade);
    if (this.btnClick) {
      if (upgrading) this.btnClick.ConfirmPreClick();
      else this.btnClick.Reset();
    }



    const doubleNode = findPath(this.root, 'group_normal/text_double_check');
    if (doubleNode) {
      if (upgrading) this.scene.clearFade(doubleNode);
      else this.scene.setFade(doubleNode, 0);
    }
  }

  
  _settleConfirm(show) {
    if (!this.confirmBasePath) return;
    const name = show ? this.confirmClips.inName : this.confirmClips.outName;
    const clip = (this.scene.panelDoc.clips || {})[name];
    if (!clip) return;
    this.scene.setSettle('upgrade-confirm', {
      doc: this.scene.panelDoc,
      clipName: name,
      t: Number(clip.len) || 0,
      basePath: this.confirmBasePath,
    });
  }

  
  animClip(field) {
    const anim = (this.anims && this.anims[field]) || null;
    return anim && anim.clip ? anim.clip : null;
  }

  
  showUpgradeAnim() {
    const anim = this.anims && this.anims._upgradeAnim;
    if (anim && anim.on) setActive(anim.on, true);
  }

  
  hideUpgradeAnim() {
    const anim = this.anims && this.anims._upgradeAnim;
    if (anim && anim.on) setActive(anim.on, false);
  }

  
  playUpgradeAnim() {
    const anim = this.anims && this.anims._upgradeAnim;
    if (!anim || !anim.clip) return null;
    this.upgradePlaying = 1;
    this.showUpgradeAnim();
    if (this.scene && this.scene.motion) {
      this.scene.motion.play('upgrade', anim.clip, {
        doc: this.scene.panelDoc,
        basePath: anim.on ? anim.on.path : this.root.path,
        done: () => { this.hideUpgradeAnim(); this.scene.markDirty('state'); },
      });
    }
    return { clip: anim.clip, on: anim.on };
  }

  
  onDisable() {
    this.upgradePlaying = 0;
  }

  
  Render(data) {
    this.initCost();
    this.renderShopLevel(data);
    this.renderUpgradeState(data);




    setText(findPath(this.root, 'group_normal/text_tip'), t('升级'));
    setText(findPath(this.root, 'group_disable/text_tip'), t('升级'));
    setText(findPath(this.root, 'group_max/text_tip'), t('已满级'));
    setText(findPath(this.root, 'group_normal/text_double_check'), t('确认升级'));
    return this;
  }

  
  EventOnFirstClick() {
    return { message: 106, slotId: 'upgrade' };
  }

  
  EventOnUpgrade() {
    return { message: 104 };
  }

  
  EventOnUpgradeNotEnough() {
    return { toast: 'AUTO_CHESS_SHOP_UPGRADE_COIN_TIPS' };
  }
}
