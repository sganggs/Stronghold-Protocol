// Stage B shop canvas: the in-game mount of the WebGL shop host (add-only alternative to ShopBar).
//
// The host owns the canvas, hotspots, PIXI, RAF and listeners; this component only
//  - mounts it into the `.gm__hud` shop slot and hands the element to `barRef` (the buy hotkey and the
//    old ShopBar both resolve their card through that root),
//  - forwards m.private pushes as `update()` calls (the renderer stays a pure function of the model),
//  - implements the prefab's two-tap flow (first tap arms + opens the detail, second tap acts) and
//  - disposes the host when the gate closes (theme switch, group capability lost, failed runtime, …).
//
// It never calls actions.* directly: every action goes through the props the game screen passes, so the
// existing toasts, error tone, pending guards and server round-trip stay in one place.
//
// The host's callbacks are registered once at mount, so the click handlers read the live state through
// refs (a plain `armed` state captured by the mount effect would never see the second tap).

import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../components.js';
import { t } from '../../../../shared/i18n.js';
import { PHASE } from '../../../../shared/constants.js';
import { PLUGIN_OFFER_SLOTS } from '../../../../shared/plugins/limits.js';
import { data } from '../../data.js';
import { mergeHint } from '../shopBar.js';
import { shopBlockReason, mergeProgress, handFull, offerHeader } from '../gameLogic.js';
import { useStore } from '../../store.js';
import { skinsStore, ownerSkin } from '../skins.js';
import { useSettings } from '../settings.js';
import { createShopHost } from './host.js';
import { shopCardMarks, filterCardMarks } from './marks.js';

/** Taps inside the shop, its detail panel or a dialog do not disarm (the old ShopBar's useTwoTap rule). */
const KEEP_ARMED = '[data-shop-webgl], .dpanel, .modal';

/** The chess record resolver the merge hint needs: the merge need (upgradeNum) lives on the record, and the hint
 * must read the same one as the owned pips (viewOf's card flags use data.lookup('chess', id) too). */
const lookupChess = (id) => data.lookup('chess', id);

/**
 * Game-data files whose localized or late-arriving copies feed the card model: the record names and bonds,
 * the item icons, the garrison icons/colours, the imported theme group (`local`), and the stand-in / DIY
 * records (`backups`, read by adapter/model.js through ownStandIn / ownDiyRecord).
 */
export const LOCALE_FILES = Object.freeze(['chess', 'items', 'bonds', 'garrisons', 'assets', 'backups', 'local']);

/**
 * The shop row the renderer should draw. With a rewardOffer the official UI keeps the normal shop frame but
 * shows the offer's cards at price 0 in the row's last positions (a long offer — the 6-slot 精锐版一次性促销券 —
 * grows the row to its own length); the item slot is not shown. Every offer slot is drawn up to the server's cap
 * (MAX_OFFER_SLOTS = shared/plugins/limits.js PLUGIN_OFFER_SLOTS, server/match/player/common.js): a malformed
 * offer with more slots is clamped to the first cap many, as the server slices its own list; a 2- or 3-slot offer
 * lands in the last two or three positions exactly as before. Without an offer — or after 稍后 (`rewardMin`, the
 * DOM bar's rewardMin state) — the original private is used unchanged.
 * @param {any} priv
 * @param {boolean} [rewardMin] the player put the pick off: draw the normal shop row
 * @returns {{ slots: any[]|null, start: number, count: number, offer: any }|null}
 */
export function shopRewardRow(priv, rewardMin = false, phase = null) {
  if (rewardMin || (phase && phase !== PHASE.PREP)) return null;
  const offer = priv && priv.shop && priv.shop.rewardOffer;
  if (!offer || !Array.isArray(offer.slots) || !offer.slots.length) return null;
  const shop = priv.shop || {};
  const normal = Array.isArray(shop.slots) ? shop.slots : [];
  const layoutChess = Number(shop.layout && shop.layout.chess);
  const chessCount = Number.isInteger(layoutChess) && layoutChess > 0
    ? layoutChess
    : normal.filter((slot) => slot && slot.kind !== 'item').length;
  const count = Math.min(PLUGIN_OFFER_SLOTS, offer.slots.length);
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

/**
 * Whether the row on screen is the synthesised reward row. ShopCanvas marks its root with this
 * (`data-shop-reward-row`) so bandCommand's SHOP_SLOT drag — whose targets are privacy indices — never
 * highlights or drops on the offer's display positions.
 * @param {any} priv
 * @param {boolean} [rewardMin]
 * @param {string|null} [phase]
 * @returns {boolean}
 */
export function shopRewardRowActive(priv, rewardMin = false, phase = null) {
  return shopRewardRow(priv, rewardMin, phase) !== null;
}

/** A copy of private with the reward row synthesised into shop.slots (no item slot, no FREE flag). */
export function shopDisplayPrivate(priv, rewardMin = false, phase = null) {
  const row = shopRewardRow(priv, rewardMin, phase);
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
export function shopDisplaySlot(priv, index, rewardMin = false, phase = null) {
  const row = shopRewardRow(priv, rewardMin, phase);
  if (row) return row.slots[index] || null;
  const slots = priv && priv.shop && Array.isArray(priv.shop.slots) ? priv.shop.slots : [];
  return slots[index] || null;
}

/** The reward.slots index a display index selects, or -1 when it is an empty front slot or the pick is minimized. */
export function shopRewardIndex(priv, index, rewardMin = false, phase = null) {
  const row = shopRewardRow(priv, rewardMin, phase);
  if (!row) return -1;
  return index >= row.start && index < row.start + row.count ? index - row.start : -1;
}

/**
 * The renderer's per-slot merge flags. Operator and equipment cards both participate: an equipment card merges
 * with the same item (mergeable / upgradeNum), and a fusion component also lights the repeated FX when its fuse
 * partner (canFuse / fuseWith, two different items) is already owned (the official card's hasFusePartner).
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
        // Two different equipment fuse (规程 only, canFuse / fuseWith / fuseResult): owning the partner lights the
        // same repeated FX as a mergeable duplicate does, which is what the official card's hasFusePartner reports.
        hasFusePartner: record.canFuse === true
          && typeof record.fuseWith === 'string'
          && ownItemCount(record.fuseWith) > 0,
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
 * The re-mount key of the shop host: a language switch must destroy and re-mount it, because the canvas texts
 * and the card/bond/item model are built at mount time; a still toggle must too, because createShopHost
 * captures `still` at construction. game.js keys the component by the one-argument (language) form; the host
 * effect below keys itself with the still-aware form, so a still change is what re-runs it.
 * @param {string|null|undefined} lang
 * @param {boolean} [still]
 */
export function shopMountKey(lang, still = false) {
  const key = String(lang || 'zh');
  return still ? `${key}#still` : key;
}

/**
 * The host's `still` option: 设置 → 主题动画 off, or the OS prefers-reduced-motion. A still shop draws pinned
 * card poses (`scene.stillCards`) and parks the themed spine idle (ShopCanvas.pauseSpine), which also stops the
 * host's ambient repaint — nothing in the canvas moves on its own.
 * @param {any} settings the player settings (`themeMotion`)
 * @param {boolean} [reduced] `reducedMotion()` (ui/device.js)
 * @returns {boolean}
 */
export function shopStill(settings, reduced = false) {
  return (settings && settings.themeMotion === false) || !!reduced;
}

/** The reason a control hotspot refuses a click while the reward row occupies the shop. */
export function rewardControlReason(offer, rewardMin = false, phase = null) {
  const visible = !!(offer && Array.isArray(offer.slots) && offer.slots.length && !rewardMin
    && (!phase || phase === PHASE.PREP));
  return visible ? t('请先选择奖励') : null;
}

/**
 * The minimized reward control's label: 选择{title}. The title is the offerHeader's (already localized)
 * title — 晋升奖励 / 定向投放 / 见者有份 / 寻呼模块 / 松果 / 特殊招募 / 装备补给 — so the two shops name an
 * offer the same way. The seven known names are six glyphs at most in zh; any other title still names the
 * offer and the prefab's `bestFit` shrinks the face to the pill, as the other languages' templates already
 * do (en drops the verb). No title (an empty offer) keeps the generic 选择奖励.
 * @param {{ title?: string }|null} head `offerHeader(offer)`
 * @returns {string}
 */
export function rewardPickLabel(head) {
  const title = head && typeof head.title === 'string' ? head.title.trim() : '';
  return title ? t('选择{title}', { title }) : t('选择奖励');
}

/**
 * Whether the folded shop keeps the reward control (设置 → 操作「折叠商店时保留奖励按钮」, default off). The canvas
 * has no DOM pill: with the setting on, the same prefab pill stays on the folded tab so a pending offer is reachable
 * without unfolding; off (the default) the whole shop — pill included — folds away like the refresh/freeze controls.
 * @param {{ collapsed?: boolean, phase?: string|null, offer?: any, enabled?: boolean }} [o]
 * @returns {boolean}
 */
export function shopFoldReward({ collapsed = false, phase = null, offer = null, enabled = false } = {}) {
  if (!enabled || !collapsed) return false;
  if (!offer || !Array.isArray(offer.slots) || !offer.slots.length) return false;
  if (phase && phase !== PHASE.PREP) return false;
  return true;
}

/**
 * The reward control's view (`view.reward`): the ctrl paints its label, the count badge shows how many
 * offers wait (this one + `queued`), and the hotspot's aria-label reads the offer's own name.
 *
 * The label names what the button holds. While the offer row is drawn it is 稍后 (the row's cards already
 * show what the reward is); once the player put the pick off, the row is the normal shop again and the
 * button reads 选择{title} — 选择晋升奖励, 选择定向投放, 选择见者有份 … — composed from offerHeader's
 * localized title, so a promotion reward and a strategy's special refresh no longer look alike. A queued
 * offer that becomes the current one after a pick is the new `offer`, so the label and the count follow the
 * server's push (this view is a pure function of `priv.shop.rewardOffer.queued` and the offer itself).
 * @param {any} offer `priv.shop.rewardOffer`
 * @param {{ rewardMin?: boolean, phase?: string|null }} [o]
 * @returns {{ count: number, visible: boolean, label: string, title: string, micro: string,
 *   sub: string, more: string|null }|null} null without a pending offer, or outside PREP
 */
export function shopRewardView(offer, { rewardMin = false, phase = null } = {}) {
  if (!offer || !Array.isArray(offer.slots) || !offer.slots.length) return null;
  if (phase && phase !== PHASE.PREP) return null;
  const head = offerHeader(offer);
  return {
    count: Math.max(1, (Number(offer.queued) || 0) + 1),
    visible: !rewardMin,
    label: rewardMin ? rewardPickLabel(head) : t('稍后'),
    // The DOM bar's own header fields, carried for the aria label (no extra strip is drawn on the canvas).
    title: head.title,
    micro: head.micro,
    sub: head.sub,
    more: head.more,
  };
}

/**
 * The block reason per control hotspot (null = may fire), the same wording the old ShopBar shows. The reward
 * row occupies the shop's refresh/freeze controls until 稍后 (`rewardControlReason`); the level-up card is
 * never gated by the offer. Refresh uses shopBlockReason's own rule: the server already turns a free refresh
 * into refreshPrice 0, and a special offer does not refresh for free; a non-editable seat is refused there too.
 * @param {any} p ShopCanvas props (`priv`, `editable`, `config`, `phase`, `rewardMin`)
 * @returns {{ refresh: string|null, freeze: string|null, levelUp: string|null }}
 */
export function shopControlReasons(p = {}) {
  const offer = p.priv && p.priv.shop && p.priv.shop.rewardOffer;
  const chooseFirst = rewardControlReason(offer, p.rewardMin, p.phase);
  return {
    refresh: chooseFirst || shopBlockReason('refresh', { config: p.config, priv: p.priv, editable: p.editable }),
    freeze: chooseFirst || (p.editable ? null : shopBlockReason('freeze', { config: p.config, priv: p.priv, editable: p.editable })),
    levelUp: shopBlockReason('levelUp', { config: p.config, priv: p.priv, editable: p.editable }),
  };
}

/**
 * The buy hotkey's priv slot index. `[data-shop-slot]` is the display-row index, which is the priv.shop.slots
 * index only while the normal row is drawn. The canvas synthesises the pending offer's row (shopRewardRow), so
 * on the canvas the hotkey must stay off those cards (the two-tap flow owns them) until 稍后 — rewardMin — puts
 * the normal row back. The DOM bar draws the offer as RewardCards instead, which carry no `data-shop-slot`
 * (shopBar.js passes `free`, so the attribute is undefined), so there the index under the pointer is the priv
 * index whenever a card is found at all.
 * @param {any} priv
 * @param {number} displayIndex the matched card's `data-shop-slot`
 * @param {{ canvas?: boolean, rewardMin?: boolean }} [o] canvas: the WebGL shop is mounted; rewardMin: 稍后 pressed
 * @returns {number} the priv.shop.slots index to buy, or -1 when this display index must not buy
 */
export function shopHotkeyBuyIndex(priv, displayIndex, { canvas = false, rewardMin = false, phase = null } = {}) {
  if (!Number.isInteger(displayIndex) || displayIndex < 0) return -1;
  if (canvas && shopRewardRow(priv, rewardMin, phase)) return -1;
  const slots = priv && priv.shop && Array.isArray(priv.shop.slots) ? priv.shop.slots : [];
  return displayIndex < slots.length ? displayIndex : -1;
}

/**
 * Park the themed spine idle for a still mount; a motion mount leaves it running. `scene.stillCards` pins the
 * card clips, but the spine is a live PIXI tick (spineView.tick advances the actor every frame and its compose
 * canvas repaints with it), so a paused spine is what stops the shop's ambient animation. `pause` is safe
 * before the async `start()` settles: the flag makes the first forced paint a still frame.
 * @param {any} host the createShopHost handle
 * @param {boolean} still
 * @returns {boolean} whether the spine was asked to pause
 */
export function pauseSpine(host, still) {
  if (!still) return false;
  if (typeof host?.spine?.pause !== 'function') return false;
  try {
    host.spine.pause(true);
    return true;
  } catch {
    return false; // a spine that never loaded has nothing to pause
  }
}

/**
 * @param {{
 *   priv: any, editable: boolean, collapsed: boolean, refreshBusy?: boolean, config?: any,
 *   runtime: any, lang?: string, barRef?: any, offBonds?: any, still?: boolean,
 *   rewardMin?: boolean,
 *   onBuy: (i: number) => any, onLevel: () => any, onRefresh: () => any, onFreeze: () => any,
 *   onRewardToggle?: () => void,
 *   onCollapse: (folded: boolean) => void,
 *   onDetail?: (id: string, kind: 'chess'|'item', hint: string|null) => void,
 *   onReward?: (i: number) => any,
 *   onDetailClose?: () => void, onRefuse?: (reason: string) => void, onArm?: (card: any) => void,
 *   onFail?: (err?: any) => void,
 * }} props
 */
/**
 * The 卡面标记 switches (设置 → 外观) in the shape `filterCardMarks` reads: each group is on unless the player
 * switched it off, and 可晋升 / the owned pips both follow `progress`. Pure, so the settings → filter wiring is
 * testable without a mount.
 * @param {{ shopMarkSkill?: boolean, shopMarkStandIn?: boolean, shopMarkProgress?: boolean }|null|undefined} settings
 * @returns {{ skill: boolean, standIn: boolean, progress: boolean }}
 */
export function cardMarkSwitches(settings) {
  const s = settings || {};
  return {
    skill: s.shopMarkSkill,
    standIn: s.shopMarkStandIn,
    progress: s.shopMarkProgress,
  };
}

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
  // The shop owner's outfit choices (§37.273): the card portrait follows them exactly like the DOM card's
  // `OperatorImage` does through the same store.
  const localSkins = useStore((s) => s.skins, Object.is, skinsStore);
  // 卡面标记 switches (设置 → 外观): every group is on unless the player switched it off. The overlay is DOM
  // on the card hotspots, so a switch change only repaints the mounted host. 可晋升 and the owned-copy pips
  // share the progress switch; 替补 and 自选 share the stand-in one.
  const settings = useSettings();
  const marksOnRef = useRef(null);
  marksOnRef.current = cardMarkSwitches(settings);
  // The live push: the data subscription below is created once, so calling a closure captured at mount would push
  // the mount-time `settings` / `localSkins` snapshot (viewOf reads the fold-reward switch and the owner's outfit).
  const pushRef = useRef(null);

  // The arm timestamp is read, never recomputed: viewOf() must report when the tap happened, otherwise every
  // priv push restarts the confirm strip's clip clock.
  const armCard = (next) => {
    armedRef.current = next;
    armedAtRef.current = next ? performance.now() : 0;
    setArmed(next);
  };
  const armLevel = (next) => { levelArmedRef.current = next; setLevelArmed(next); };

  /**
   * Why each control hotspot is unavailable (null when it may fire), the same wording the old ShopBar shows.
   * Refresh uses shopBlockReason's own rule: the server already turns a free refresh into refreshPrice 0, and a
   * special offer does not refresh for free; a non-editable seat is refused there too.
   */
  const controlReasons = () => shopControlReasons(propsRef.current);

  const viewOf = () => {
    const p = propsRef.current;
    const a = armedRef.current;
    const displayPriv = shopDisplayPrivate(p.priv, !!p.rewardMin, p.phase);
    const offer = p.priv && p.priv.shop && p.priv.shop.rewardOffer;
    const reward = shopRewardView(offer, { rewardMin: !!p.rewardMin, phase: p.phase });
    const foldReward = shopFoldReward({ collapsed: !!p.collapsed, phase: p.phase, offer, enabled: settings.shopFoldRewardHint });
    const selectSlot = levelArmedRef.current ? { isUpgrade: true }
      : (a ? { slotId: a.index + 1, isGoods: true } : null);
    // The server's own row clock; null when this push has none (an older server sends no shop.refreshSeq), so the
    // host can run its signature-based fallback instead of freezing the sequence at 0 and losing the refresh clip.
    const serverRefreshSeq = displayPriv && displayPriv.shop ? displayPriv.shop.refreshSeq : null;
    return {
      state: p.collapsed ? 'fold' : 'unfold',
      // `avalid` is not `editable`: false would switch the chrome to ShopDisplayStatus.DISABLE (state_disable, the
      // panel folded away), while a non-editable seat keeps the unfolded shop like the DOM bar, which only dims the
      // cards (`is-locked`). The lock travels as `locked` so the cards, their aria and the taps follow it.
      avalid: true,
      locked: !p.editable,
      selectSlot,
      armedSlotId: a ? a.index + 1 : null,
      armedAt: a ? armedAtRef.current : 0,
      refreshSeq: serverRefreshSeq != null && Number.isFinite(Number(serverRefreshSeq))
        ? Number(serverRefreshSeq) : null,
      cardFlags: shopCardFlagsWithHand(displayPriv, (kind, id) => data.lookup(kind, id), p.config),
      // The project's own marks (替补 / 自选 / owned pips / skill / 可晋升) as a DOM overlay on the card
      // hotspots; the 卡面标记 switches drop them one by one.
      cardMarks: shopCardMarks(displayPriv, displayPriv && displayPriv.shop && displayPriv.shop.slots, {
        lookups: { getChess: (id) => data.lookup('chess', id) },
      }).map((marks) => filterCardMarks(marks, marksOnRef.current)),
      controls: controlReasons(),
      reward,
      foldReward,
      // The owner is this seat, so the local selection is what the DOM card resolves for it (§37.273).
      ownerSkin: (charId) => ownerSkin(charId, { localSkins }),
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
      host.update(shopDisplayPrivate(propsRef.current.priv, !!propsRef.current.rewardMin, propsRef.current.phase), viewOf());
    } catch (err) {
      failHost(err);
    }
  };
  // Re-point the live push at this render's closure (see pushRef above).
  pushRef.current = pushView;

  // A skin selection is card content: repaint the mounted host when it changes (the DOM card follows the
  // same store live). Kept apart from the model push below, which also disarms a stale card.
  useEffect(() => {
    pushView();
  }, [localSkins]);

  // A 卡面标记 / 折叠奖励 switch changes only the overlay or the folded pill: repaint, no remount.
  useEffect(() => {
    pushView();
  }, [settings.shopMarkSkill, settings.shopMarkStandIn, settings.shopMarkProgress, settings.shopFoldRewardHint]);

  // The host captures its renderer options at construction (createShopHost), so a motion-setting change
  // re-mounts it instead of mutating the live scene: the preloaded runtime is cached, only the scene/spine is
  // rebuilt. A language switch re-mounts for the same reason (canvas texts + localized data are built at mount).
  useEffect(() => {
    const el = hostEl.current;
    const runtime = propsRef.current.runtime;
    if (!el || !runtime || failed) return undefined;
    let dead = false;
    let host = null;
    const still = !!propsRef.current.still;
    createShopHost({
      container: el,
      priv: shopDisplayPrivate(propsRef.current.priv, !!propsRef.current.rewardMin, propsRef.current.phase),
      view: viewOf(),
      options: { runtime, still },
      callbacks: {
        onCard: (index) => tapCard(index),
        // The host's right-click path (contextmenu on the card hotspot); the old shop bar opened the same
        // detail from onContextMenu without arming.
        onCardDetail: (index) => detailCard(index),
        onOpen: () => propsRef.current.onCollapse(false),
        onClose: () => propsRef.current.onCollapse(true),
        onRefresh: () => refreshShop(),
        onFreeze: () => freezeShop(),
        onReward: () => {
          const p = propsRef.current;
          const offer = p.priv && p.priv.shop && p.priv.shop.rewardOffer;
          if (!offer || !Array.isArray(offer.slots) || !offer.slots.length) return;
          // A folded shop's copy (设置 → 操作): unfolding is the point of the click, and 稍后 is undone so the
          // offer row meets the player — the same state a 选择{title} click leaves.
          if (p.collapsed) {
            p.onCollapse(false);
            if (p.rewardMin) p.onRewardToggle?.();
            return;
          }
          p.onRewardToggle?.();
        },
        onRefuse: (reason) => propsRef.current.onRefuse?.(reason),
        onLevelUp: () => tapLevel(),
        // The host's own fatal path (WebGL context lost, a render throw in its frame loop) reports through the
        // same single failure as a thrown update, so the gate always falls back exactly once.
        onFail: (err) => failHost(err, 'host'),
      },
    }).then((created) => {
      if (dead) { created.dispose(); return; }
      host = created;
      hostApi.current = created;
      // `options.still` pins the card clips; the themed spine is a separate live tick, so park it too.
      pauseSpine(created, still);
    }).catch((err) => {
      if (dead) return;
      failHost(err, 'mount');
    });
    return () => {
      dead = true;
      hostApi.current = null;
      if (host) host.dispose();
    };
  }, [props.runtime, failed, shopMountKey(props.lang, !!props.still)]);

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
      const slot = shopDisplaySlot(p.priv, a.index, !!p.rewardMin, p.phase);
      if (!slot || slot.id !== a.id) {
        armCard(null);
        p.onArm?.(null);
        return;
      }
    }
    pushView();
  }, [props.priv, props.collapsed, props.editable, armed, levelArmed, props.refreshBusy, props.rewardMin, props.phase]);

  // A language switch remounts the host (game.js keys it by lang); the data overlays may arrive later, so a
  // localized copy of the card/bond/item files must also repaint the live host. The subscription is created once,
  // so it goes through pushRef to reach the current render's closure (the mount-time one closed over the
  // settings / outfit snapshot viewOf reads).
  useEffect(() => {
    const unsubscribe = data.subscribe((name) => {
      if (!LOCALE_FILES.includes(name)) return;
      pushRef.current?.();
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
    // A shop the player cannot buy from (ROUND_START, 准备 pressed, a pending personal choice) opens the card's
    // detail on the tap instead, exactly like the DOM bar's disabled ChessCard (shopBar.js: its `tap` falls through
    // to onDetail when the card has a reason); nothing arms and nothing buys.
    if (!p.editable) { detailCard(index); return; }
    const slot = shopDisplaySlot(p.priv, index, !!p.rewardMin, p.phase);
    if (!slot || slot.sold) return;
    const kind = slot.kind === 'item' ? 'item' : 'chess';
    const rewardIndex = shopRewardIndex(p.priv, index, !!p.rewardMin, p.phase);
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
    p.onDetail?.(slot.id, kind, kind === 'chess' ? mergeHint(p.priv, slot.id, lookupChess) : null);
  }

  /** Right-click / the host's onCardDetail: open the detail of a live card without arming it (shopBar's
   * onContextMenu). An empty or sold slot has nothing to show. */
  function detailCard(index) {
    const p = propsRef.current;
    const slot = shopDisplaySlot(p.priv, index, !!p.rewardMin, p.phase);
    if (!slot || slot.sold) return;
    const kind = slot.kind === 'item' ? 'item' : 'chess';
    p.onDetail?.(slot.id, kind, kind === 'chess' ? mergeHint(p.priv, slot.id, lookupChess) : null);
  }

  /** A control hotspot click re-checks the reason the view published: the host gates on it too, but a stale
   * or dev-page mount can still reach the callback. */
  function actWithReason(reason, act) {
    if (reason) { propsRef.current.onRefuse?.(reason); return; }
    act();
  }

  function refreshShop() {
    if (propsRef.current.refreshBusy) return;
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

  // While the reward row is drawn, [data-shop-slot] is a DISPLAY index (shopRewardRow), not a priv.shop.slots
  // index: the attribute marks the root so bandCommand's SHOP_SLOT drag (its targets are privacy indices) never
  // highlights or drops on these cards.
  const rewardRowOn = shopRewardRowActive(props.priv, !!props.rewardMin, props.phase);

  return html`<div class="shop-webgl shop-webgl--game" data-shop-webgl="" data-shop-reward-row=${rewardRowOn ? '1' : undefined} role="region" aria-label=${t('商店')}
    ref=${(el) => {
      hostEl.current = el;
      if (props.barRef) props.barRef.current = el;
    }}></div>`;
}
