// Stage B shop canvas: the in-game mount of the WebGL shop host (add-only alternative to ShopBar).
//
// The host owns the canvas, hotspots, PIXI, RAF and listeners; this component only
//  - mounts it into the `.gm__hud` shop slot and hands the element to `barRef` (the buy hotkey and the
//    old ShopBar both resolve their card through that root),
//  - forwards m.private pushes as `update()` calls (the renderer stays a pure function of the model),
//  - implements the prefab's two-tap flow (first tap arms + opens the detail, second tap acts) and
//  - disposes the host when the gate closes (theme switch, flag off, spectator, reward offer …).
//
// It never calls actions.* directly: every action goes through the props the game screen passes, so the
// existing toasts, error tone, pending guards and server round-trip stay in one place.
//
// The host's callbacks are registered once at mount, so the click handlers read the live state through
// refs (a plain `armed` state captured by the mount effect would never see the second tap).

import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../components.js';
import { t } from '../../../../shared/i18n.js';
import { data } from '../../data.js';
import { mergeHint } from '../shopBar.js';
import { shopBlockReason, mergeProgress, handFull } from '../gameLogic.js';
import { createShopHost } from './host.js';

/** Taps inside the shop, its detail panel or a dialog do not disarm (the old ShopBar's useTwoTap rule). */
const KEEP_ARMED = '[data-shop-webgl], .dpanel, .modal';

/** Game-data files whose localized copies feed the card model. */
const LOCALE_FILES = Object.freeze(['chess', 'items', 'bonds', 'garrisons', 'assets']);

/** The promotion/reward offer renders as the last three slots of the normal chess row. */
export const REWARD_SLOT_COUNT = 3;

/**
 * The shop row the renderer should draw. With a rewardOffer the official UI keeps the normal shop frame but
 * shows the normal chess-slot count: the first N-3 slots are empty and the last three are the offer's cards at
 * price 0; the item slot is not shown. Without an offer the original private is used unchanged.
 * @param {any} priv
 * @returns {{ slots: any[]|null, start: number, count: number, offer: any }|null}
 */
export function shopRewardRow(priv) {
  const offer = priv && priv.shop && priv.shop.rewardOffer;
  if (!offer || !Array.isArray(offer.slots) || !offer.slots.length) return null;
  const shop = priv.shop || {};
  const normal = Array.isArray(shop.slots) ? shop.slots : [];
  const layoutChess = Number(shop.layout && shop.layout.chess);
  const chessCount = Number.isInteger(layoutChess) && layoutChess > 0
    ? layoutChess
    : normal.filter((slot) => slot && slot.kind !== 'item').length;
  const count = Math.min(REWARD_SLOT_COUNT, offer.slots.length);
  const total = Math.max(chessCount, count);
  const start = total - count;
  const slots = Array.from({ length: total }, () => null);
  for (let i = 0; i < count; i += 1) {
    const slot = offer.slots[i];
    if (!slot || typeof slot.id !== 'string') continue;
    slots[start + i] = { ...slot, price: 0, basePrice: 0 };
  }
  return { slots, start, count, offer };
}

/** A copy of private with the reward row synthesised into shop.slots (no item slot, no FREE flag). */
export function shopDisplayPrivate(priv) {
  const row = shopRewardRow(priv);
  if (!row) return priv;
  return {
    ...priv,
    shop: {
      ...(priv.shop || {}),
      slots: row.slots,
      layout: { ...((priv.shop || {}).layout || {}), chess: row.slots.length, item: 0 },
    },
  };
}

/** The display slot at a host index (empty reward fronts are null). */
export function shopDisplaySlot(priv, index) {
  const row = shopRewardRow(priv);
  if (row) return row.slots[index] || null;
  const slots = priv && priv.shop && Array.isArray(priv.shop.slots) ? priv.shop.slots : [];
  return slots[index] || null;
}

/** The reward.slots index a display index selects, or -1 when it is an empty front slot. */
export function shopRewardIndex(priv, index) {
  const row = shopRewardRow(priv);
  if (!row) return -1;
  return index >= row.start && index < row.start + row.count ? index - row.start : -1;
}

/**
 * The renderer's per-slot merge flags. Only chess cards participate; items/empty slots are false for now
 * (the item merge path is not guessed here). The view is rebuilt on every priv/data update and language remount.
 * @param {any} priv
 * @param {(kind: string, id: string) => any} lookup data.lookup
 * @returns {Record<number, { hasSame: boolean, canComb: boolean, hasFusePartner: boolean }>}
 */
export function shopCardFlags(priv, lookup) {
  const flags = {};
  const slots = Array.isArray(priv?.shop?.slots) ? priv.shop.slots : [];
  const none = () => ({ hasSame: false, canComb: false, hasFusePartner: false });
  const ownItemCount = (id) => {
    let have = 0;
    const holders = [...(Array.isArray(priv?.board) ? priv.board : []), ...(Array.isArray(priv?.hand) ? priv.hand : []), ...(Array.isArray(priv?.temp) ? priv.temp : [])];
    for (const p of holders) {
      if (!p || typeof p !== 'object') continue;
      if (p.kind === 'item' && p.id === id) have += 1;
      if (p.kind === 'chess') for (const it of Array.isArray(p.items) ? p.items : []) if (it && it.id === id) have += 1;
    }
    return have;
  };
  slots.forEach((slot, index) => {
    if (!slot || slot.sold) { flags[index] = none(); return; }
    if (slot.kind === 'item') {
      const record = lookup('items', slot.id);
      if (!record || record.itemType !== 'EQUIP') { flags[index] = none(); return; }
      const upgradeNum = Number(record.upgradeNum) || 0;
      const target = record.upgradeChessId || record.goldenId;
      flags[index] = {
        hasSame: ownItemCount(slot.id) > 0,
        canComb: record.mergeable === true && record.isGolden !== true && upgradeNum > 1 && !!target && !!lookup('items', target),
        hasFusePartner: false,
      };
      return;
    }
    const record = lookup('chess', slot.id);
    if (!record) { flags[index] = none(); return; }
    const progress = mergeProgress(priv, slot.id, (id) => lookup('chess', id));
    flags[index] = {
      hasSame: progress.copies > 0,
      canComb: progress.need > 1 && !record.isGolden,
      hasFusePartner: false,
    };
  });
  return flags;
}

/**
 * `shopCardFlags` plus the availability bit the card model paints (`cardModelFromSlot` reads
 * `flags.isHandFull`, the card view folds it into its 无法购买 strip). A full hand refuses every purchase
 * (server HAND_FULL, GitHub #82), an equipment row under the `equipHand` rule fills its own temp row
 * (ui/gameLogic/shop.js handFull). Kept apart from `shopCardFlags` so that function keeps its published
 * shape (hasSame/canComb/hasFusePartner) that the flags regression test pins.
 * @param {any} priv
 * @param {(kind: string, id: string) => any} lookup data.lookup
 * @param {any} [config] data.get('config') — only the equipHand rule of items depends on it
 * @returns {Record<number, { hasSame: boolean, canComb: boolean, hasFusePartner: boolean, isHandFull: boolean }>}
 */
export function shopCardFlagsWithHand(priv, lookup, config = null) {
  const flags = shopCardFlags(priv, lookup);
  const slots = Array.isArray(priv?.shop?.slots) ? priv.shop.slots : [];
  for (const [key, flag] of Object.entries(flags)) {
    const slot = slots[Number(key)];
    flag.isHandFull = !!(slot && !slot.sold) && handFull(priv, slot.kind, config);
  }
  return flags;
}

/**
 * The React key of the shop host: a language switch must destroy and re-mount it, because the canvas texts
 * and the card/bond/item model are built at mount time. Exported for the pure language-key test.
 * @param {string|null|undefined} lang
 */
export function shopMountKey(lang) {
  return String(lang || 'zh');
}

/**
 * @param {{
 *   priv: any, editable: boolean, collapsed: boolean, refreshBusy?: boolean, config?: any,
 *   runtime: any, lang?: string, barRef?: any, offBonds?: any,
 *   onBuy: (i: number) => any, onLevel: () => any, onRefresh: () => any, onFreeze: () => any,
 *   onCollapse: (folded: boolean) => void,
 *   onDetail?: (id: string, kind: 'chess'|'item', hint: string|null) => void,
 *   onReward?: (i: number) => any,
 *   onDetailClose?: () => void, onRefuse?: (reason: string) => void, onArm?: (card: any) => void,
 *   onFail?: (err?: any) => void,
 * }} props
 */
export function ShopCanvas(props) {
  const hostEl = useRef(null);
  const hostApi = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const [armed, setArmed] = useState(null);          // { kind, key, index, id }
  const [levelArmed, setLevelArmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const armedRef = useRef(null);
  const armedAtRef = useRef(0);
  const levelArmedRef = useRef(false);
  const failedRef = useRef(false);

  // The arm timestamp is read, never recomputed: viewOf() must report when the tap happened, otherwise every
  // priv push restarts the confirm strip's clip clock.
  const armCard = (next) => {
    armedRef.current = next;
    armedAtRef.current = next ? performance.now() : 0;
    setArmed(next);
  };
  const armLevel = (next) => { levelArmedRef.current = next; setLevelArmed(next); };

  /** Why each control hotspot is unavailable (null when it may fire), the same wording the old ShopBar shows. */
  const controlReasons = () => {
    const p = propsRef.current;
    return {
      refresh: p.refreshBusy ? t('正在刷新…') : shopBlockReason('refresh', { config: p.config, priv: p.priv, editable: p.editable }),
      freeze: p.editable ? null : shopBlockReason('freeze', { config: p.config, priv: p.priv, editable: p.editable }),
      levelUp: shopBlockReason('levelUp', { config: p.config, priv: p.priv, editable: p.editable }),
    };
  };

  const viewOf = () => {
    const p = propsRef.current;
    const a = armedRef.current;
    const displayPriv = shopDisplayPrivate(p.priv);
    const selectSlot = levelArmedRef.current ? { isUpgrade: true }
      : (a ? { slotId: a.index + 1, isGoods: true } : null);
    return {
      state: p.collapsed ? 'fold' : 'unfold',
      avalid: true,
      selectSlot,
      armedSlotId: a ? a.index + 1 : null,
      armedAt: a ? armedAtRef.current : 0,
      cardFlags: shopCardFlagsWithHand(displayPriv, (kind, id) => data.lookup(kind, id), p.config),
      controls: controlReasons(),
    };
  };

  /** A failed update means the canvas can no longer be trusted: report it once, stop pushing and let the
   * gate fall back to the old ShopBar (never retry a broken frame loop). */
  const failHost = (err, stage = 'update') => {
    if (failedRef.current) return;
    failedRef.current = true;
    hostApi.current = null;
    setFailed(true);
    console.warn(`[shop-webgl] ${stage} failed`, err);
    propsRef.current.onFail?.(err);
  };

  /** Push the current arm/view synchronously: the effect runs only after the parent (and the detail panel)
   * re-renders, which put the confirm strip up to a few hundred ms after the tap. Every push is guarded:
   * a renderer throw must not escape the click handler or the data subscription. */
  const pushView = () => {
    const host = hostApi.current;
    if (!host || failedRef.current) return;
    try {
      host.update(shopDisplayPrivate(propsRef.current.priv), viewOf());
    } catch (err) {
      failHost(err);
    }
  };

  useEffect(() => {
    const el = hostEl.current;
    const runtime = propsRef.current.runtime;
    if (!el || !runtime || failed) return undefined;
    let dead = false;
    let host = null;
    createShopHost({
      container: el,
      priv: shopDisplayPrivate(propsRef.current.priv),
      view: viewOf(),
      options: { runtime },
      callbacks: {
        onCard: (index) => tapCard(index),
        // The host's right-click path (contextmenu on the card hotspot); the old shop bar opened the same
        // detail from onContextMenu without arming.
        onCardDetail: (index) => detailCard(index),
        onOpen: () => propsRef.current.onCollapse(false),
        onClose: () => propsRef.current.onCollapse(true),
        onRefresh: () => refreshShop(),
        onFreeze: () => freezeShop(),
        onLevelUp: () => tapLevel(),
        // The host's own fatal path (WebGL context lost, a render throw in its frame loop) reports through the
        // same single failure as a thrown update, so the gate always falls back exactly once.
        onFail: (err) => failHost(err, 'host'),
      },
    }).then((created) => {
      if (dead) { created.dispose(); return; }
      host = created;
      hostApi.current = created;
    }).catch((err) => {
      if (dead) return;
      failHost(err, 'mount');
    });
    return () => {
      dead = true;
      hostApi.current = null;
      if (host) host.dispose();
    };
  }, [props.runtime, failed, props.lang]);

  // m.private / fold / selection changes are plain model pushes; the host repaints.
  useEffect(() => {
    const host = hostApi.current;
    if (!host || failedRef.current) return;
    const p = propsRef.current;
    if (!p.editable && (armedRef.current || levelArmedRef.current)) {
      armCard(null);
      armLevel(false);
      return;
    }
    const a = armedRef.current;
    if (a) {
      const slot = shopDisplaySlot(p.priv, a.index);
      if (!slot || slot.id !== a.id) {
        armCard(null);
        p.onArm?.(null);
        return;
      }
    }
    pushView();
  }, [props.priv, props.collapsed, props.editable, armed, levelArmed, props.refreshBusy]);

  // A language switch remounts the host (game.js keys it by lang); the data overlays may arrive later, so a
  // localized copy of the card/bond/item files must also repaint the live host.
  useEffect(() => {
    const unsubscribe = data.subscribe((name) => {
      if (!LOCALE_FILES.includes(name)) return;
      pushView();
    });
    return unsubscribe;
  }, []);

  // The old bar hands the armed card back when it unmounts (game.js lights the merge tile from it).
  useEffect(() => () => propsRef.current.onArm?.(null), []);

  // The old bar disarms on a tap outside the shop/detail dialog and on Escape; keep that here.
  useEffect(() => {
    if (!armed && !levelArmed) return undefined;
    const onDown = (event) => {
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest(KEEP_ARMED)) return;
      if (armedRef.current) { armCard(null); propsRef.current.onArm?.(null); }
      if (levelArmedRef.current) armLevel(false);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (armedRef.current) { armCard(null); propsRef.current.onArm?.(null); }
      if (levelArmedRef.current) armLevel(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [armed, levelArmed]);

  function tapCard(index) {
    const p = propsRef.current;
    if (!p.editable) return;
    const slot = shopDisplaySlot(p.priv, index);
    if (!slot || slot.sold) return;
    const kind = slot.kind === 'item' ? 'item' : 'chess';
    const rewardIndex = shopRewardIndex(p.priv, index);
    const key = `${rewardIndex >= 0 ? 'r' : kind}:${kind === 'chess' ? slot.id : String(index)}:${slot.id}`;
    const current = armedRef.current;
    const armedHere = current && current.index === index && current.key === key;
    if (armedHere) {
      const reason = shopBlockReason(rewardIndex >= 0 ? 'reward' : 'buy', { config: p.config, priv: p.priv, editable: p.editable, slot });
      if (reason) { p.onRefuse?.(reason); return; }
      armCard(null);
      pushView();
      p.onArm?.(null);
      p.onDetailClose?.();
      // A reward pick is g.reward, never actions.buy; the server clears rewardOffer and the normal row
      // reappears through the same mounted host (no remount).
      if (rewardIndex >= 0) p.onReward?.(rewardIndex);
      else p.onBuy(index);
      return;
    }
    armCard({ kind, key, index, id: slot.id, reward: rewardIndex >= 0 });
    pushView();
    p.onArm?.({ kind, id: slot.id });
    p.onDetail?.(slot.id, kind, kind === 'chess' ? mergeHint(p.priv, slot.id) : null);
  }

  /** Right-click / the host's onCardDetail: open the detail of a live card without arming it (shopBar's
   * onContextMenu). An empty or sold slot has nothing to show. */
  function detailCard(index) {
    const p = propsRef.current;
    const slot = shopDisplaySlot(p.priv, index);
    if (!slot || slot.sold) return;
    const kind = slot.kind === 'item' ? 'item' : 'chess';
    p.onDetail?.(slot.id, kind, kind === 'chess' ? mergeHint(p.priv, slot.id) : null);
  }

  /** A control hotspot click re-checks the reason the view published: the host gates on it too, but a stale
   * or dev-page mount can still reach the callback. */
  function actWithReason(reason, act) {
    if (reason) { propsRef.current.onRefuse?.(reason); return; }
    act();
  }

  function refreshShop() {
    actWithReason(controlReasons().refresh, () => propsRef.current.onRefresh());
  }

  function freezeShop() {
    actWithReason(controlReasons().freeze, () => propsRef.current.onFreeze());
  }

  function tapLevel() {
    const p = propsRef.current;
    const reason = shopBlockReason('levelUp', { config: p.config, priv: p.priv, editable: p.editable });
    if (reason) {
      if (levelArmedRef.current) { armLevel(false); p.onArm?.(null); }
      p.onRefuse?.(reason);
      return;
    }
    if (!levelArmedRef.current) { armLevel(true); pushView(); return; }
    armLevel(false);
    pushView();
    p.onArm?.(null);
    p.onLevel();
  }

  return html`<div class="shop-webgl shop-webgl--game" data-shop-webgl="" role="region" aria-label=${t('商店')}
    ref=${(el) => {
      hostEl.current = el;
      if (props.barRef) props.barRef.current = el;
    }}></div>`;
}
