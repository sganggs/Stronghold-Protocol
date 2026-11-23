// m.private → shop view model for the WebGL renderer.
//
// This is not a content table: every field comes from the product's data store (data.lookup for the current
// official version, whatever the room runs) and the existing assetUrls helpers (portrait / prof.mark / item
// and bond icons). The renderer reads a plain model, so switching a room's version needs no reload here.

import { data } from '../../../data.js';
import { chessPortraitUrl, profMarkUrl, itemIconUrl, localItemIconUrl, bondIconUrl, uiUrl } from '../../assetUrls.js';
import { ownDiyRecord } from '../../gameLogic/diy.js';
import { ownStandIn } from '../../gameLogic/standIn.js';
import { DEFAULT_SKIN_COLORS } from '../../../../../shared/uiTheme.js';
import { AutoChessBattleShopSlot, AutoChessBattleShopViewModel } from '../model.js';

/** Official card garrison tint: normal -> colour 1, tier 5 -> colour 2, tier 6 -> colour 3. */
export function garrisonTintFor(colors, tier) {
  const garrisonColors = [(colors || {}).garrisonIconColor1, (colors || {}).garrisonIconColor2, (colors || {}).garrisonIconColor3];
  return garrisonColors[tier >= 6 ? 2 : (tier === 5 ? 1 : 0)] || '#FFFFFF';
}

/**
 * The operator portrait a card draws (§37.273): the owner's outfit picture when the caller resolved one,
 * else the operator's own — the same order as the DOM card's `OperatorImage`.
 * @param {any} m the composed asset manifest
 * @param {any} record chess.json record (null for an item slot)
 * @param {string|null} [skin] the shop owner's skinId for that operator
 */
export function cardPortraitFile(m, record, skin = null) {
  return record ? chessPortraitUrl(m, record, { skin }) : null;
}

/**
 * One shop card model (the fields the ported AutoChessBattleShopCardView reads).
 * @param {any} slot m.private shop slot `{ kind, id, price, basePrice, sold, frozen }`
 * @param {number} index slot index (the buy index)
 * @param {any} priv m.private
 * @param {{ armedSlotId?: number|null, armedAt?: number, cardFlags?: any,
 *   colors?: Record<string, string>, urlOf?: (file: string) => string|null,
 *   ownerSkin?: (charId: string) => string|null }} [opts]
 *   `ownerSkin` is the shop owner's outfit choice (§37.273): the DOM card's `OperatorImage` follows the same
 *   selection; without the resolver a card keeps the operator's own portrait.
 */
export function cardModelFromSlot(slot, index, priv, opts = {}) {
  const shop = (priv && priv.shop) || {};
  const kind = slot && slot.kind === 'item' ? 'item' : 'chess';
  const id = slot && slot.id ? slot.id : '';
  const m = data.get('assets') || {};
  // The padded item sprite of the local-client extraction (official m_Rect canvas) when it is there; the
  // fetched items entry is the trimmed mirror copy the DOM slots show with object-fit: contain.
  const local = data.get('local') || null;
  const baseRecord = kind === 'item' ? data.lookup('items', id) : data.lookup('chess', id);
  // DIY lineup: a filled DIY slot is its owner's picked operator (the DOM card's `ownDiyRecord`), not the slot's
  // faceless base record. The composed record keeps the slot's tier/price and brings the operator's name, art, class
  // and bonds; the official card has no extra badge, so the canvas draws it like any other operator card.
  const diyRecord = kind === 'chess' && baseRecord && baseRecord.isDiy
    ? ownDiyRecord(baseRecord, priv, { chess: data.get('chess'), backups: data.get('backups') })
    : null;
  // Stand-in: a chess the player marked as not owned shows its stand-in body (the DOM card's `ownStandIn`), while the
  // record keeps the chess's identity (ids, tier, bonds, price, merge).
  const standIn = kind === 'chess' && !diyRecord && baseRecord
    ? ownStandIn(baseRecord, priv, data.get('backups'))
    : null;
  const record = diyRecord || standIn || baseRecord;
  const colors = { ...DEFAULT_SKIN_COLORS, ...(opts.colors || {}) };
  const tier = Number((record && record.tier) || 1);
  const price = Number(slot && slot.price) || 0;
  const srcPrice = Number(slot && slot.basePrice) || price;
  const armed = Number.isInteger(opts.armedSlotId) && opts.armedSlotId === index + 1;
  const flags = (opts.cardFlags && opts.cardFlags[index]) || null;
  const bonds = kind === 'chess' && Array.isArray(record && record.bonds)
    ? record.bonds.map((bondId) => {
      const bond = data.lookup('bonds', bondId) || {};
      return { id: bondId, name: bond.name || bondId, iconId: bond.iconId || null, iconFile: bondIconUrl(m, bondId) };
    })
    : [];
  const firstGarrison = kind === 'chess' && Array.isArray(record && record.garrisonIds) ? record.garrisonIds[0] : null;
  const garrison = firstGarrison ? data.lookup('garrisons', firstGarrison) : null;
  const garrisonIcon = garrison && garrison.eventTypeIcon ? uiUrl(m, `garrisonTypeIcon/${garrison.eventTypeIcon}`) : null;
  const profession = kind === 'chess' && record ? String(record.profession || '') : '';
  const portraitSkin = kind === 'chess' && typeof opts.ownerSkin === 'function'
    ? opts.ownerSkin((record && record.charId) || id) : null;
  return {
    // 1-based: AutoChessBattleShopSlot.slotId is the C# index the prefab confirm strip selects by. The display
    // index (`[data-shop-slot]`, ShopCanvas a.index, shopRewardIndex) is 0-based; both call sites add 1 here.
    slotId: index + 1,
    id,
    name: (record && record.name) || id,
    tier,
    level: tier,
    price,
    srcPrice,
    currCoin: Number(priv && priv.funds) || 0,
    isChar: kind !== 'item',
    isEmpty: !slot || !!slot.sold,
    // Per-slot frozen OR the toggle, the same precedence as the DOM bar slotFrozen (shopBar.js, GitHub #354): a
    // 猎头顾问 copy stays frozen while the toggle is off.
    isFrozen: !!(slot && (slot.frozen || shop.frozen)),
    isHandFull: !!(flags && flags.isHandFull),
    hasSame: !!(flags && flags.hasSame),
    hasFusePartner: !!(flags && flags.hasFusePartner),
    canComb: !!(flags && flags.canComb),
    difficulty: null,
    diff: null,
    armed,
    armedAt: armed ? Number(opts.armedAt) || 0 : 0,
    bonds: kind !== 'item',
    icon: kind === 'item' && record ? (record.iconId || record.trapId || '') : '',
    iconFile: kind === 'item' && record ? (localItemIconUrl(local, record) || itemIconUrl(m, record)) : null,
    // Content the card view paints (all URLs resolved from data + assetUrls, never from a theme path).
    profession,
    portraitFile: kind === 'chess' ? cardPortraitFile(m, record, portraitSkin) : null,
    profMarkFile: profession ? profMarkUrl(m, profession) : null,
    bondList: bonds,
    bondColor: colors.bondColor || '#000000',
    nameColor: colors.chessNameColor || '#FFFFFF',
    garrisonIconFile: garrisonIcon,
    garrisonTint: garrisonTintFor(colors, tier),
    garrisonIds: Array.isArray(record && record.garrisonIds) ? record.garrisonIds.slice() : [],
    colors,
    urlOf: typeof opts.urlOf === 'function' ? opts.urlOf : null,
  };
}

/**
 * m.private → AutoChessBattleShopViewModel.
 * @param {any} priv m.private push (`funds`, `deployCap`, `deployCount`, `shop`)
 * @param {{ selectSlot?: any, refreshSeq?: number, unfold?: boolean, avalid?: boolean,
 *   show?: boolean, armedSlotId?: number|null, armedAt?: number, maxLevel?: number,
 *   colors?: Record<string, string>, urlOf?: (file: string) => string|null, cardFlags?: any,
 *   ownerSkin?: (charId: string) => string|null,
 *   controls?: { refresh?: string|null, freeze?: string|null, levelUp?: string|null }|null,
 *   reward?: { count?: number, visible?: boolean, label?: string, title?: string, micro?: string,
 *     sub?: string, more?: string|null }|null, foldReward?: boolean }} [opts]
 *   `controls`: the caller's per-control block reasons (host `view.controls`): a non-empty `refresh` reason
 *   blocks the painted refresh button, so the ctrl panel and the hotspot agree; absent → no gate published.
 */
export function shopModelFromPrivate(priv, opts = {}) {
  const shop = (priv && priv.shop) || {};
  const maxLevel = Number(opts.maxLevel) || Number(shop.maxLevel) || 6;
  const level = Number(shop.level) || 1;
  const upgradeCost = level >= maxLevel ? 0 : (Number(shop.upgradePrice) || 0);
  const coinCount = Number(priv && priv.funds) || 0;
  const slots = Array.isArray(shop.slots) ? shop.slots : [];
  const layout = shop.layout && Number.isInteger(shop.layout.chess) ? shop.layout : null;
  const controls = opts.controls && typeof opts.controls === 'object' ? opts.controls : null;
  // The slots panel selects its refresh clip from the server's shop fields, not from a queued rewardOffer:
  // C# isSpecialRecruit = goodsType != 0, and the roll marker is one-shot. `specialRefresh` is this roll's
  // marker (server rollShop); `goodsType` is kept for callers that send the official enum value.
  const goodsType = Number(shop.goodsType) || 0;
  const specialRefresh = !!shop.specialRefresh;
  // `specialRefreshArmed` is the charge that has not rolled yet (佩佩 arms it on the level-up itself), and it is
  // the only source of the button state: C# `isSpecRefresh ← ShopData.specialRefresh`, the pending charge, while
  // `isSpecialRecruit` comes from `goodsType != 0` (this row). The roll marker below is product's stand-in for
  // that goodsType, so it feeds the slots clip and never the button.
  const specialRefreshArmed = !!shop.specialRefreshArmed;
  const cards = [];
  slots.forEach((slot, index) => {
    if (slot == null && layout && index >= layout.chess + layout.item) return;
    cards.push(cardModelFromSlot(slot, index, priv, {
      armedSlotId: opts.armedSlotId, armedAt: opts.armedAt, cardFlags: opts.cardFlags,
      colors: opts.colors, urlOf: opts.urlOf, ownerSkin: opts.ownerSkin,
    }));
  });
  const selectSlot = opts.selectSlot instanceof AutoChessBattleShopSlot
    ? opts.selectSlot
    : new AutoChessBattleShopSlot(opts.selectSlot || {});
  const deployCap = Number(priv && priv.deployCap);
  const deployCount = Number(priv && priv.deployCount);
  const remainCharCnt = Number.isFinite(deployCap) && Number.isFinite(deployCount)
    ? Math.max(0, deployCap - deployCount)
    : Number(shop.remainCharCnt) || 0;
  return new AutoChessBattleShopViewModel({
    show: opts.show ?? true,
    avalid: opts.avalid ?? true,
    unfold: opts.unfold ?? true,
    level,
    maxLevel,
    coinCount,
    refreshCost: Number(shop.refreshPrice) || 0,
    upgradeCost,
    // upgradeCost == srcPrice, so CalcPriceColor's normal colour applies; affordability is the cost view's
    // normal/grey toggle and must not paint the grey number red.
    upgradeCostColor: '#FFC600',
    freeRefreshCnt: Number(shop.freeRefreshes) || 0,
    isFrozen: !!shop.frozen,
    // A queued rewardOffer is a pick-one reward, not a shop refresh; the view collapses its source to
    // 'merge'|'special' for the header, so it must not light the refresh button's root_special fx.
    isSpecRefresh: specialRefreshArmed,
    isSpecialRecruit: goodsType !== 0 || specialRefresh,
    goodsType,
    remainCharCnt,
    selectSlot,
    currUIFunc: 0,
    dragCharSellPrice: 0,
    refreshSeq: Number(opts.refreshSeq ?? shop.refreshSeq) || 0,
    refreshBlocked: controls ? !!(controls.refresh) : null,
    freezeBlocked: controls ? !!(controls.freeze) : null,
    reward: opts.reward || null,
    foldReward: !!opts.foldReward,
    slots: cards,
  });
}

/**
 * The row's identity, which is what the refresh clip reacts to: `shopSignature` covers the slot layout and
 * every slot's (kind, id), and nothing else. m.private carries no refresh sequence, so the host bumps one
 * when this changes — a purchase (sold), a freeze, a price shift or a level-up must NOT replay the refresh
 * animation: only a replaced row does. Those other changes still repaint through the card model/mainView.
 * @param {any} priv
 * @returns {string}
 */
export function shopSignature(priv) {
  const shop = (priv && priv.shop) || {};
  const slots = Array.isArray(shop.slots) ? shop.slots : [];
  const layout = shop.layout && Number.isInteger(shop.layout.chess) && Number.isInteger(shop.layout.item)
    ? `${shop.layout.chess}:${shop.layout.item}` : '';
  const row = slots
    .map((slot) => (slot ? `${slot.kind === 'item' ? 'item' : 'chess'}:${slot.id || ''}` : '-'))
    .join('|');
  return `${layout}|${row}`;
}
