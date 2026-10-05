// Underframe — the selection diamond of a tapped own piece (research 09 §1.2 "Tap a deployed unit", §5, §6.5;
// official `act2autochess_panel_character_menu`: `util_btn` icon_sell + price "+1", funcId autochessSale; the
// destroy variant `_underFramePanelBtnParamDestroyPos` with icon_destory).
//
//   board operator  → 撤退 (upper-left: back to the bench) + 出售 +N (upper-right)
//   board summon    → 撤退
//   bench operator  → 出售 +N
//   item / Art      → 销毁
// The diamond frames the piece's tile; only its buttons take pointer events, so the unit under it can still be
// dragged (moving it — or dropping it back on its own tile to re-orient it with the wheel). The game screen shows the
// unit's range tiles (rotated to its facing) and the detail card beside it while it is selected (on the side away
// from the unit, `underframeRect` / gameLogic `panelSide`), and the underframe sits above every HUD panel, so its
// buttons are never covered.
//
// Button look (user playtest #2 item 7): the official sprites icon_sell / icon_destory are WHITE octagon plates with
// the glyph cut out — tinted in the client. Drawn as is they read as a plain white block, so each button is a coloured
// octagon plate: the sprite is used as a CSS mask over the plate colour (出售 amber like every money action, 销毁 /
// 撤退 red) on a dark backing that shows through the glyph cut-out. Without the local sprites the same plate carries
// the built-in glyph.
//
// TempRowNotice (user playtest #3 item 3) — the other board-anchored overlay of the prep: while the temp overflow row
// (临时整备区, row 8, the 5 pads in front of the bench) holds pieces, a dashed red frame around that row and a label at
// its end say that they block 准备就绪 and are destroyed when the prep ends unless moved to the bench, equipped or used.
// Placed through view.tileScreen (useTileScreen, so it follows the camera — the Final Assault prep too); it never takes
// the pointer, so the pieces under it stay draggable.

import { html, HexBadge, Icon } from './components.js';
import { GIcon } from './gameComponents.js';
import { useTileScreen } from './facingWheel.js';
import { localAsset } from '../data.js';
import { GEO } from '../../../shared/constants.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Runner glyph of 撤退 (a figure leaving through a door; original shape). */
function RetreatGlyph() {
  return html`<svg class="uframe__glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13.5 3.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9.6 8.3l3.7-.6 2.2 3.3 2.7 1-.6 1.8-3.4-1.2-.9-1.3-.8 3.2 2.6 2.6V22h-2v-4.7l-2.4-2.3-.9 3.6-4.4-1 .5-1.9 2.4.5 1.6-6.6-1 .3-1.4 2.8-1.8-.9 1.9-3.6z" />
    <path d="M2 5h5v2H4v10h3v2H2z" opacity=".7" />
  </svg>`;
}

/**
 * A tinted octagon plate: the official sprite (white plate, glyph cut out) as a mask over the tone colour, or the
 * built-in glyph on the same plate when the local sprite is not installed.
 * @param {{ sprite: string, glyph: string, tone: 'sell'|'destroy' }} props
 */
export function PlateIcon({ sprite, glyph, tone }) {
  const url = localAsset('ui/battle', sprite);
  return html`<span class=${cx('uframe__plate', `uframe__plate--${tone}`, url ? 'has-mask' : 'is-glyph')}
      style=${url ? `--uf-mask:url("${url}")` : ''} data-sprite=${url ? sprite : null} aria-hidden="true">
    ${url ? null : html`<${GIcon} name=${glyph} class="uframe__pglyph" />`}
  </span>`;
}

/**
 * Client-px rect the underframe of a tile covers: the diamond plus its buttons (plates, labels, the +N price) — the
 * geometry of the css below (.uframe__btn--retreat / --sell: .56rem plates at 25 % / 75 % across, 25 % down, shifted
 * −80 % / −20 % horizontally and −90 % vertically). Used for the detail panel placement.
 * @param {{ x: number, y: number, s: number }|null} g view.tileScreen(row, col)
 * @param {number} [rem] root font size (px)
 * @returns {{ left: number, right: number, top: number, bottom: number }|null}
 */
export function underframeRect(g, rem = 100) {
  if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return null;
  const s = g.s > 0 ? g.s : 64;
  const half = s * 1.05;
  const P = rem * 0.56;                 // plate
  const H = P + rem * 0.26;             // plate + label
  const q = half / 2;                   // 25 % / 75 % of the diamond box, from its centre
  const btnTop = g.y - q - 0.9 * H;
  const left = Math.min(g.x - half, g.x - q - 0.8 * P);
  const right = Math.max(g.x + half, g.x + q - 0.2 * P + P + rem * 0.14);
  return { left, right, top: Math.min(g.y - half, btnTop - rem * 0.08), bottom: g.y + half };
}

/**
 * @param {{ view: any, uid?: number|null, row: number, col: number, actions: { retreat: boolean, sell: number|null, destroy: boolean },
 *   name?: string, busy?: boolean, onRetreat?: () => void, onSell?: () => void, onDestroy?: () => void }} props
 */
export function Underframe({ view, uid = null, row, col, actions, name = '', busy = false, onRetreat, onSell, onDestroy }) {
  const g = useTileScreen(view, row, col);
  if (!g || !actions) return null;
  const s = g.s > 0 ? g.s : 64;
  const half = s * 1.05;
  const stop = (e) => e.stopPropagation();
  return html`<div class="uframe" data-uid=${uid} style=${`left:${g.x}px;top:${g.y}px;width:${half * 2}px;height:${half * 2}px`} role="group"
      aria-label=${`${name || '单位'} 操作`}>
    <svg class="uframe__dia" viewBox="-110 -110 220 220" aria-hidden="true">
      <path class="uframe__outer" d="M0 -100 L100 0 L0 100 L-100 0 Z" />
      <path class="uframe__corner" d="M-100 0 L-86 -14 M-100 0 L-86 14 M100 0 L86 -14 M100 0 L86 14 M0 -100 L-14 -86 M0 -100 L14 -86 M0 100 L-14 86 M0 100 L14 86" />
    </svg>
    ${actions.retreat ? html`<button type="button" class="uframe__btn uframe__btn--retreat" disabled=${busy} onPointerDown=${stop}
        onClick=${(e) => { stop(e); onRetreat?.(); }} title=${actions.sell != null ? '撤退至整备区（Q）' : '撤退至整备区'} aria-label="撤退" aria-keyshortcuts=${actions.sell != null ? 'Q' : undefined}>
      <${RetreatGlyph} /><span class="uframe__label">${actions.sell != null ? '撤退[Q]' : '撤退'}</span>
    </button>` : null}
    ${actions.sell != null ? html`<button type="button" class="uframe__btn uframe__btn--sell" disabled=${busy} onPointerDown=${stop}
        onClick=${(e) => { stop(e); onSell?.(); }} title=${`出售（+${actions.sell} 资金，X）`} aria-label=${`出售，获得 ${actions.sell} 资金`} aria-keyshortcuts="X">
      <${PlateIcon} sprite="icon_sell" glyph="sell" tone="sell" />
      <span class="uframe__label">出售[X]</span>
      <${HexBadge} value=${`+${actions.sell}`} tone="gold" size="sm" class="uframe__price" />
    </button>` : null}
    ${actions.destroy ? html`<button type="button" class=${cx('uframe__btn', 'uframe__btn--destroy')} disabled=${busy} onPointerDown=${stop}
        onClick=${(e) => { stop(e); onDestroy?.(); }} title="销毁道具" aria-label="销毁">
      <${PlateIcon} sprite="icon_destory" glyph="trash" tone="destroy" />
      <span class="uframe__label">销毁</span>
    </button>` : null}
  </div>`;
}

// ---- the temp overflow row (临时整备区) ---------------------------------------------------------------------------

/**
 * Screen frame of the temp row from its two end tiles (view.tileScreen of cols TEMP_C0 and TEMP_C0 + TEMP_SIZE − 1): the
 * quad [back-left, back-right, front-right, front-left] (back = the far edge, higher on screen — also when the Final
 * Assault prep mirrors the board), its bounds, and the side of the label: left of the row, or right of it when the
 * left has no room for `labelW` px. Pure (test/ui/playtest3.test.js).
 * @param {{ poly: Array<[number, number]> } | null} a @param {{ poly: Array<[number, number]> } | null} b
 * @param {{ labelW?: number, gap?: number, vw?: number }} [opts]
 * @returns {{ quad: Array<[number, number]>, left: number, right: number, top: number, bottom: number, y: number, side: 'left'|'right' } | null}
 */
export function tempRowFrame(a, b, { labelW = 0, gap = 8, vw = Infinity } = {}) {
  const ok = (t) => t && Array.isArray(t.poly) && t.poly.length >= 4 && t.poly.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!ok(a) || !ok(b)) return null;
  const backs = [a.poly[0], a.poly[1], b.poly[0], b.poly[1]];
  const fronts = [a.poly[2], a.poly[3], b.poly[2], b.poly[3]];
  const minX = (pts) => pts.reduce((m, p) => (p[0] < m[0] ? p : m));
  const maxX = (pts) => pts.reduce((m, p) => (p[0] > m[0] ? p : m));
  const quad = [minX(backs), maxX(backs), maxX(fronts), minX(fronts)];
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const side = left - gap - labelW >= 0 || right + gap + labelW > vw ? 'left' : 'right';
  return { quad, left, right, top, bottom, y: (top + bottom) / 2, side };
}

/**
 * What the temp row's label says will happen to its pieces (server/match/PlayerState.js tempDue): a piece is resolved
 * at the end of the first prep in which the player can act on it. Not ready (or outside PREP): at the end of this / the
 * coming prep, and 准备就绪 waits for the row to be cleared. Ready in PREP: Ready is refused while the row holds pieces,
 * so whatever lies there arrived after it — kept through the NEXT prep (cancelling Ready makes it due at this one).
 * @param {boolean} ready m.private ready (during PREP)
 */
export function tempRowRule(ready) {
  return ready
    ? '已准备就绪后进入的单位保留到下个休整期，届时仍在此处的将被销毁（取消准备则在本休整期结束时销毁）'
    : '放入整备区或战场、配发或使用后才能准备；休整期结束时仍在此处的将被销毁';
}

/**
 * The temp row's notice: dashed red frame + label (count, what to do, what happens at the end of the prep — tempRowRule).
 * `label` false (a piece is being dragged / placed): the frame only, nothing over the pieces the player is moving.
 * @param {{ view: any, count: number, items?: number, label?: boolean, ready?: boolean }} props
 */
export function TempRowNotice({ view, count, items = 0, label = true, ready = false }) {
  const a = useTileScreen(view, GEO.TEMP_ROW, GEO.TEMP_C0);
  const b = useTileScreen(view, GEO.TEMP_ROW, GEO.TEMP_C0 + GEO.TEMP_SIZE - 1);
  let rem = 100;
  try { rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100; } catch { /* default */ }
  const vw = globalThis.innerWidth || 1920;
  const f = count > 0 ? tempRowFrame(a, b, { labelW: rem * 2.9, gap: rem * 0.1, vw }) : null;
  if (!f) return null;
  const pts = f.quad.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const pad = rem * 0.1;
  const style = f.side === 'left' ? `left:${(f.left - pad).toFixed(1)}px;top:${f.y.toFixed(1)}px` : `left:${(f.right + pad).toFixed(1)}px;top:${f.y.toFixed(1)}px`;
  const what = items > 0 && items === count ? '件道具' : '个单位';
  return html`<div class="tempnote" aria-hidden="false" data-testid="temp-notice">
    <svg class="tempnote__frame" aria-hidden="true"><polygon points=${pts} /></svg>
    ${label ? html`<div class=${`tempnote__label is-${f.side}`} style=${style} role="status">
      <b class="tempnote__title"><${Icon} name="warn" />临时整备区 <span class="num">${count}</span> ${what}待处理</b>
      <span class="tempnote__rule">${tempRowRule(ready)}</span>
    </div>` : null}
  </div>`;
}
