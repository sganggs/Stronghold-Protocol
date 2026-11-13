// ui/gameLogic/panel.js — detail card and bond popup placement. Re-exported from ../gameLogic.js.

import { isObj } from './shared.js';


// ---- detail panel placement (user playtest #2 item 8) ---------------------------------------------------------------

/**
 * Which side the detail panel goes to so it never covers the selected unit's underframe: the default 'left' panel
 * unless the underframe (buttons included) overlaps it and the 'right' slot is clear of it (else 'left' — the
 * underframe is drawn above the panel anyway, css z-index).
 * @param {{ left: number, right: number, top: number, bottom: number }|null} uf underframe rect (client px)
 * @param {{ left: {left:number,right:number,top:number,bottom:number}, right: {left:number,right:number,top:number,bottom:number} }} slots
 * @returns {'left'|'right'}
 */
export function panelSide(uf, slots) {
  if (!isObj(uf) || !isObj(slots)) return 'left';
  const hit = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  if (!hit(uf, slots.left)) return 'left';
  return hit(uf, slots.right) ? 'left' : 'right';
}

/**
 * Client-px rects of the two detail panel slots (css .dpanel / .dpanel--right in rem): left at 2.3rem, right against
 * the right edge above the shop bar when it is open.
 * @param {{ width: number, height: number, left?: number, top?: number }} vp the HUD layer's box (.gm__hud): its size,
 *   and its client offset — the HUD sits inside the safe-area insets (css/devices.css), so on a notched phone the
 *   panels start `left` / `top` px further in than the viewport edge (default 0: the whole viewport)
 * @param {number} rem root font size (px)
 * @param {{ shopOpen?: boolean, reg?: boolean }} [o] `reg`: the 规程 shop (taller)
 */
export function panelSlots(vp, rem, { shopOpen = false, reg = false } = {}) {
  const W = Number(vp?.width) || 1920;
  const H = Number(vp?.height) || 1080;
  const X = Number.isFinite(vp?.left) ? vp.left : 0;
  const Y = Number.isFinite(vp?.top) ? vp.top : 0;
  const R = rem > 0 ? rem : 100;
  const top = R * 2.1;
  const leftH = Math.min(R * 8.4, H - top - R * 1.02);
  const shopInset = !reg ? PANEL_RIGHT_BOTTOM_SHOP : H <= 430 ? PANEL_RIGHT_BOTTOM_SHOP_REG_SHORT : PANEL_RIGHT_BOTTOM_SHOP_REG;
  const rightBottom = H - R * (shopOpen ? shopInset : PANEL_RIGHT_BOTTOM);
  return {
    left: { left: X + R * 2.3, right: X + R * (2.3 + 4.9), top: Y + top, bottom: Y + top + leftH },
    right: { left: X + W - R * (PANEL_RIGHT_GAP + 4.9), right: X + W - R * PANEL_RIGHT_GAP, top: Y + top, bottom: Y + Math.max(top + R, rightBottom) },
  };
}
/** Right detail panel slot insets (rem; keep in sync with css/screens/game-panels.css .dpanel--right). */
export const PANEL_RIGHT_GAP = 0.9;
export const PANEL_RIGHT_BOTTOM = 1.02;
export const PANEL_RIGHT_BOTTOM_SHOP = 3.78;
/** The same above the 规程 shop (css/screens/game-reghud.css .gm--reg .dpanel--right.is-shop; a ≤ 430px high viewport: _SHORT). */
export const PANEL_RIGHT_BOTTOM_SHOP_REG = 4.44;
export const PANEL_RIGHT_BOTTOM_SHOP_REG_SHORT = 2.92;

/** Bond popup geometry (rem; keep in sync with css/screens/game-panels.css .bpop / .bpop--*). */
export const BPOP = Object.freeze({ width: 5.4, top: 2.1, bottomGap: 0.3, left: 2.3, beside: 7.32, besideR: 5.92, right: 0.9 });

/**
 * Where the bond popup opens (css .bpop--<place>) so it neither hides the open detail card nor covers the selected
 * unit's underframe (user playtest #2 items 8 / 9): next to the card first ('beside' the left card, 'besideR' left of
 * the right card), else the free side of the screen ('left' at 2.3rem / 'right' against the right edge), else over the
 * card it was opened from; without a card the popup's usual place is 'left'. When every candidate covers the
 * underframe the first one is kept (the underframe is drawn above the popup, css z-index).
 * @param {{ left: number, right: number, top: number, bottom: number }|null} uf underframe rect (client px) or null
 * @param {{ width: number, height: number, left?: number, top?: number }} vp the HUD layer's box (see panelSlots)
 * @param {number} rem root font size (px)
 * @param {'left'|'right'|null} card side of the open detail card (null: none)
 * @returns {'left'|'beside'|'besideR'|'right'}
 */
export function bondPopupPlace(uf, vp, rem, card = null) {
  const W = Number(vp?.width) || 1920;
  const H = Number(vp?.height) || 1080;
  const X = Number.isFinite(vp?.left) ? vp.left : 0;
  const Y = Number.isFinite(vp?.top) ? vp.top : 0;
  const R = rem > 0 ? rem : 100;
  const top = Y + R * BPOP.top;
  const bottom = Y + Math.max(R * BPOP.top + R, H - R * BPOP.bottomGap);
  const rectOf = (p) => {
    const left = X + (p === 'left' ? R * BPOP.left : p === 'beside' ? R * BPOP.beside
      : p === 'besideR' ? W - R * (BPOP.besideR + BPOP.width) : W - R * (BPOP.right + BPOP.width));
    return { left, right: left + R * BPOP.width, top, bottom };
  };
  // last resort: over the card it was opened from (closing the popup shows the card again)
  const order = card === 'left' ? ['beside', 'right', 'left'] : card === 'right' ? ['besideR', 'left', 'right'] : ['left', 'right'];
  if (!isObj(uf)) return order[0];
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return order.find((p) => !hit(uf, rectOf(p))) || order[0];
}
