

export class ChromeViewData {
  constructor(init = {}) {
    this.isAvailable = init.isAvailable ?? true;
    this.isUnfold = init.isUnfold ?? true;
    this.isGoldCountUp = !!init.isGoldCountUp;
    this.canRaiseShopAvgSignal = !!init.canRaiseShopAvgSignal;
    this.coinCount = init.coinCount ?? 0;
    this.level = init.level ?? 1;
    this.remainCharCnt = init.remainCharCnt ?? 0;
    this.skinId = init.skinId ?? '';
  }
}

export class SlotsViewData {
  constructor(init = {}) {
    this.isSpecialRecruit = !!init.isSpecialRecruit;
    this.refreshSeq = init.refreshSeq ?? 0;
    this.selectSlot = init.selectSlot || null;
    this.slots = init.slots || [];
    this.onCardConfirm = init.onCardConfirm || null;
  }
}

export class CtrlViewData {
  constructor(init = {}) {
    this.isSpecialRecruit = !!init.isSpecialRecruit;
    this.isSpecRefresh = !!init.isSpecRefresh;
    this.isFrozen = !!init.isFrozen;
    this.coinCount = init.coinCount ?? 0;
    this.refreshCost = init.refreshCost ?? 0;
    this.freeRefreshCnt = init.freeRefreshCnt ?? 0;
    /** true = the caller's shopBlockReason('refresh') blocks it; null = no gate published (dev page/old callers). */
    this.refreshBlocked = init.refreshBlocked ?? null;
    this.freezeBlocked = init.freezeBlocked ?? null;
    this.reward = init.reward || null;
  }
}

export class UpgradeViewData {
  constructor(init = {}) {
    this.coinCount = init.coinCount ?? 0;
    this.level = init.level ?? 1;
    this.maxLevel = init.maxLevel ?? 6;
    this.upgradeCost = init.upgradeCost ?? 0;
    this.upgradeCostColor = init.upgradeCostColor ?? '#FFFFFF';
    this.selectSlot = init.selectSlot || null;
    this.skinId = init.skinId ?? '';
  }
}
