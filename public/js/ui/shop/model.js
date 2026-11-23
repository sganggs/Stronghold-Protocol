// Shop UI model (the C# AutoChessBattleShopViewModel + AutoChessBattleShopSlot field tables).
// Ported from the lab's shop/model.js without its fixtures: the lab's mockStore/modelFromStore and the
// store snapshot classes existed only for the lab page's fake server. Stage A/B build the view model from
// the product's m.private push (adapter/model.js) instead.

/** ShopDisplayStatus (the C# chrome panel's display enum). */
export const ShopDisplayStatus = Object.freeze({ NONE: 0, DISABLE: 1, FOLD: 2, UNFOLD: 3 });

/** ThreeStateToggle.State. */
export const ThreeStateToggleState = Object.freeze({ UNSELECT: 0, FIRST_SELECT: 1, SECOND_SELECT: 2 });

/** AutoChessDragUIFunction (sell view drag modes; no view in this stage). */
export const AutoChessDragUIFunction = Object.freeze({ NONE: 0, CHAR: 1, EQUIP: 2 });

/**
 * AutoChessBattleShopSlot — the selected slot (goods / upgrade). The reference C# type is not in the
 * decompiled set; only the fields the view model and the upgrade/slots panels read are kept.
 */
export class AutoChessBattleShopSlot {
  constructor(init = {}) {
    this.slotId = init.slotId ?? 0;
    this.isGoods = !!init.isGoods;
    this.isUpgrade = !!init.isUpgrade;
    this.sold = !!init.sold;
    this.isChar = init.isChar !== false;
  }
}

/**
 * AutoChessBattleShopViewModel — every property the panels read (the C# ViewModel's get_/set_ pair is a
 * plain field here, same semantics).
 */
export class AutoChessBattleShopViewModel {
  constructor(init = {}) {
    this.show = init.show ?? true;
    this.avalid = init.avalid ?? true;
    this.unfold = init.unfold ?? true;
    /** The seat may look but not buy (not editable: ROUND_START, 准备 pressed, a pending personal choice). The
     * panel stays unfolded like the DOM bar's locked card row; only the cards dim and refuse. */
    this.locked = !!init.locked;
    this.showMainPanel = init.showMainPanel ?? true;
    this.showSellCharPanel = !!init.showSellCharPanel;
    this.showSellEquipPanel = !!init.showSellEquipPanel;
    this.level = init.level ?? 1;
    this.maxLevel = init.maxLevel ?? 6;
    this.coinCount = init.coinCount ?? 0;
    this.refreshCost = init.refreshCost ?? 0;
    this.upgradeCost = init.upgradeCost ?? 0;
    this.upgradeCostColor = init.upgradeCostColor ?? '#FFFFFF';
    this.freeRefreshCnt = init.freeRefreshCnt ?? 0;
    this.isFrozen = !!init.isFrozen;
    this.isSpecRefresh = !!init.isSpecRefresh;
    this.isSpecialRecruit = !!init.isSpecialRecruit;
    this.goodsType = init.goodsType ?? 0;
    this.remainCharCnt = init.remainCharCnt ?? 0;
    this.selectSlot = init.selectSlot instanceof AutoChessBattleShopSlot
      ? init.selectSlot
      : new AutoChessBattleShopSlot(init.selectSlot || {});
    this.currUIFunc = init.currUIFunc ?? 0;
    this.dragCharSellPrice = init.dragCharSellPrice ?? 0;
    this.refreshSeq = init.refreshSeq ?? 0;
    /** The caller's own refresh block (ShopCanvas's shopBlockReason('refresh') reason): true = blocked, null = no
     * gate published (dev page / old callers); the ctrl panel paints the control from it rather than from funds. */
    this.refreshBlocked = init.refreshBlocked ?? null;
    this.freezeBlocked = init.freezeBlocked ?? null;
    /** Pending reward control: `{ count, visible, label }` or null (see ShopCanvas.viewOf). */
    this.reward = init.reward || null;
    /** Keep the reward control on the folded tab (设置 → 操作): true only while a pending offer should stay reachable. */
    this.foldReward = !!init.foldReward;
    /** Card row: AutoChessBattleShopCardViewModel-shaped records (see adapter/model.js). */
    this.slots = init.slots || [];
  }
}
