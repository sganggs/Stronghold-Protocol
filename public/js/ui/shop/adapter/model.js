// m.private → shop view model for the WebGL renderer.
//
// This is not a content table: every field comes from the product's data store (data.lookup for the current
// official version, whatever the room runs) and the existing assetUrls helpers (portrait / prof.mark / item
// and bond icons). The renderer reads a plain model, so switching a room's version needs no reload here.

import { data } from '../../../data.js';
import { chessPortraitUrl, profMarkUrl, itemIconUrl, bondIconUrl, uiUrl } from '../../assetUrls.js';
import { DEFAULT_SKIN_COLORS } from '../../../../../shared/uiTheme.js';
import { AutoChessBattleShopSlot, AutoChessBattleShopViewModel } from '../model.js';

/**
 * One shop card model (the fields the ported AutoChessBattleShopCardView reads).
 * @param {any} slot m.private shop slot `{ kind, id, price, basePrice, sold, frozen }`
 * @param {number} index slot index (the buy index)
 * @param {any} priv m.private
 * @param {{ armedSlotId?: number|null, armedAt?: number, cardFlags?: any,
 *   colors?: Record<string, string>, urlOf?: (file: string) => string|null }} [opts]
 */
export function cardModelFromSlot(slot, index, priv, opts = {}) {
  const shop = (priv && priv.shop) || {};
  const kind = slot && slot.kind === 'item' ? 'item' : 'chess';
  const id = slot && slot.id ? slot.id : '';
  const m = data.get('assets') || {};
  const record = kind === 'item' ? data.lookup('items', id) : data.lookup('chess', id);
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
  const garrisonColors = [colors.garrisonIconColor1, colors.garrisonIconColor2, colors.garrisonIconColor3];
  const profession = kind === 'chess' && record ? String(record.profession || '') : '';
  return {
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
    iconFile: kind === 'item' && record ? itemIconUrl(m, record) : null,
    // Content the card view paints (all URLs resolved from data + assetUrls, never from a theme path).
    profession,
    portraitFile: kind === 'chess' && record ? chessPortraitUrl(m, record) : null,
    profMarkFile: profession ? profMarkUrl(m, profession) : null,
    bondList: bonds,
    bondColor: colors.bondColor || '#000000',
    nameColor: colors.chessNameColor || '#FFFFFF',
    garrisonIconFile: garrisonIcon,
    garrisonTint: garrisonColors[tier >= 6 ? 2 : (tier === 5 ? 1 : 0)] || '#FFFFFF',
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
 *   colors?: Record<string, string>, urlOf?: (file: string) => string|null, cardFlags?: any }} [opts]
 */
export function shopModelFromPrivate(priv, opts = {}) {
  const shop = (priv && priv.shop) || {};
  const maxLevel = Number(opts.maxLevel) || Number(shop.maxLevel) || 6;
  const level = Number(shop.level) || 1;
  const upgradeCost = level >= maxLevel ? 0 : (Number(shop.upgradePrice) || 0);
  const coinCount = Number(priv && priv.funds) || 0;
  const slots = Array.isArray(shop.slots) ? shop.slots : [];
  const layout = shop.layout && Number.isInteger(shop.layout.chess) ? shop.layout : null;
  const cards = [];
  slots.forEach((slot, index) => {
    if (slot == null && layout && index >= layout.chess + layout.item) return;
    cards.push(cardModelFromSlot(slot, index, priv, {
      armedSlotId: opts.armedSlotId, armedAt: opts.armedAt, cardFlags: opts.cardFlags,
      colors: opts.colors, urlOf: opts.urlOf,
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
    isSpecRefresh: !!(shop.rewardOffer && shop.rewardOffer.source === 'special'),
    isSpecialRecruit: !!(shop.rewardOffer && shop.rewardOffer.source === 'special'),
    goodsType: 0,
    remainCharCnt,
    selectSlot,
    currUIFunc: 0,
    dragCharSellPrice: 0,
    refreshSeq: Number(opts.refreshSeq) || 0,
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
