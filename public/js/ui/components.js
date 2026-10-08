// Design-system components (Preact + htm, no build step). Styles live in css/components.css.
//
// Exports: html (bound htm), Icon, Button, Panel, MicroLabel, Chevrons, HexBadge, TierChip,
// BondDisc, SevenSeg, Countdown, Modal, confirmDialog/alertDialog + DialogHost, Tooltip +
// TooltipLayer, ProgressBar, Tabs, Spinner, AvatarFrame, PhaseBanner, ResultDialog, PingPill, DifficultyTag,
// DifficultyIcon, TextField, UiHosts (mount once: dialogs + tooltips), useTicker, secondsLeft/hasDeadline,
// roman(), doctorNo().
//
// Look: research 06 §11–§12 — near-black green-grey panels, 1px lines, mint accents, bracket
// corners, hexagon badges, roman tier chips, bond discs with segmented rings, 7-segment countdown
// (orange ≤10 s), chevron phase banners. Motion 150–250 ms. All sizes are rem (1rem = 100 design
// px at 1920×1080, see css/theme.css).

import { h, Fragment } from '../../vendor/preact.module.js';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from '../../vendor/hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { DIFFICULTY_NAMES, DIFFICULTY_COLORS } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';
import { serverNow } from '../store.js';
import { data, useData, localAsset } from '../data.js';
import { uiUrl } from './assetUrls.js';

/**
 * h() for htm with its static-subtree cache switched off. htm keeps the vnode it built for a fully static subtree in
 * the template's op list and hands the SAME object out on every render; Preact mounts that shared vnode (it gets
 * its DOM node and parent chain written into it), so after the screen unmounts the module-level template cache
 * still points at the detached DOM, its listeners and the old component tree — whole stale screens pile up over a
 * session. `this[0] = 3` marks the element dynamic (htm's documented opt-out), so every render gets fresh vnodes.
 */
export function hFresh(type, props, ...children) {
  if (this && typeof this === 'object') this[0] = 3;
  return h(type, props, ...children);
}

/** Tagged-template JSX replacement bound to Preact's h() (no shared static vnodes, see hFresh). */
export const html = htm.bind(hFresh);
export { h, Fragment };

const cx = (...parts) => parts.flat().filter(Boolean).join(' ');

// ---- icons ---------------------------------------------------------------------------------------

/** 24×24 glyph paths (original, simple geometric shapes). `eo` = even-odd fill rule. */
export const ICONS = {
  check: { d: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z' },
  close: { d: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z' },
  exit: { d: 'M20 3H10v2h8v14h-8v2h10zM8.4 7.4 7 6l-6 6 6 6 1.4-1.4L4.8 13H15v-2H4.8z' },
  crown: { d: 'M3 7l4.6 4.2L12 4l4.4 7.2L21 7l-1.8 10H4.8zM5 19h14v2H5z' },
  robot: { d: 'M11 2h2v3h4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h4zM8.5 9.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zm7 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM9 15v1.6h6V15zM1 10h2v5H1zm20 0h2v5h-2z', eo: true },
  copy: { d: 'M8 3h11v13h-2V5H8zM5 7h10v14H5zm2 2v10h6V9z', eo: true },
  link: { d: 'M9 7H6.5a5 5 0 0 0 0 10H9v-2H6.5a3 3 0 0 1 0-6H9zm6 0h2.5a5 5 0 0 1 0 10H15v-2h2.5a3 3 0 0 0 0-6H15zM8 11h8v2H8z' },
  plus: { d: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z' },
  minus: { d: 'M4 11h16v2H4z' },
  user: { d: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 7 0 0 1 16 0z' },
  users: { d: 'M9 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM2 20a7 6.5 0 0 1 14 0zM16.5 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm.9 8.1A6.5 6 0 0 1 22.5 20H18a8.6 8 0 0 0-2.4-6.1 6 6 0 0 1 1.8-.8z' },
  rook: { d: 'M5 3h3v2h2V3h4v2h2V3h3v5l-2 2v7l2 2v2H5v-2l2-2v-7L5 8z' },
  signal: { d: 'M2 17h3v4H2zm6-4h3v8H8zm6-4h3v12h-3zm6-4h3v16h-3z' },
  refresh: { d: 'M12 4a8 8 0 0 1 7.4 5H17v2h6V5h-2v2.3A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8zm0 16a8 8 0 0 1-7.4-5H7v-2H1v6h2v-2.3A10 10 0 0 0 22 12h-2a8 8 0 0 1-8 8z' },
  snow: { d: 'M11 2h2v4.2l2.3-2.3 1.4 1.4-3.7 3.7v2h2l3.7-3.7 1.4 1.4-2.3 2.3H22v2h-4.2l2.3 2.3-1.4 1.4-3.7-3.7h-2v2l3.7 3.7-1.4 1.4-2.3-2.3V22h-2v-4.2l-2.3 2.3-1.4-1.4 3.7-3.7v-2H9l-3.7 3.7-1.4-1.4L6.2 13H2v-2h4.2L3.9 8.7l1.4-1.4L9 11h2V9L7.3 5.3l1.4-1.4L11 6.2z' },
  chevronRight: { d: 'M8.6 5 7.2 6.4 12.8 12l-5.6 5.6L8.6 19l7-7z' },
  chevronLeft: { d: 'M15.4 5l1.4 1.4-5.6 5.6 5.6 5.6-1.4 1.4-7-7z' },
  chevrons: { d: 'M5.6 5 4.2 6.4 9.8 12l-5.6 5.6L5.6 19l7-7zm7 0-1.4 1.4 5.6 5.6-5.6 5.6 1.4 1.4 7-7z' },
  hourglass: { d: 'M6 2h12v2h-1v3.5L13.5 12l3.5 4.5V20h1v2H6v-2h1v-3.5l3.5-4.5L7 7.5V4H6zm3 2v2.8l3 3.9 3-3.9V4zm0 16h6v-2.8l-3-3.9-3 3.9z', eo: true },
  dots: { d: 'M5 10.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm7 0a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm7 0a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z' },
  key: { d: 'M14.5 3a6.5 6.5 0 1 1-2.6 12.5l-1.1 1.1H9v2H7v2H3v-3.6l5.5-5.5A6.5 6.5 0 0 1 14.5 3zm1.5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', eo: true },
  search: { d: 'M10 3a7 7 0 0 1 5.6 11.2l5.6 5.6-1.4 1.4-5.6-5.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', eo: true },
  info: { d: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8v7h2v-7zm0-3v2h2V7z', eo: true },
  warn: { d: 'M12 2 1 21h22zm-1 7v6h2V9zm0 7.5v2h2v-2z', eo: true },
  play: { d: 'M7 4v16l13-8z' },
  mic: { d: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21H8v2h8v-2h-3v-3.1A7 7 0 0 0 19 11z' },
  edit: { d: 'M3 17.2V21h3.8l11-11-3.8-3.8zM20.7 7.1a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z' },
  sword: { d: 'M20 3h1v4L10.4 17.6l1.4 1.4-1.4 1.4-2.1-2.1-3.5 3.5-1.4-1.4 3.5-3.5L4.8 14.8l1.4-1.4 1.4 1.4L18 4z' },
  shield: { d: 'M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z' },
  wifiOff: { d: 'M2 17h3v4H2zm6-4h3v8H8zm6-4h3v12h-3zm6-4h3v16h-3zM2.4 1 23 21.6 21.6 23 1 2.4z' },
  expand: { d: 'M3 3h7v2H5v5H3zm11 0h7v7h-2V5h-5zM3 14h2v5h5v2H3zm16 0h2v7h-7v-2h5z' },
  collapse: { d: 'M8 3h2v7H3V8h5zm6 0h2v5h5v2h-7zM3 14h7v7H8v-5H3zm11 0h7v2h-5v5h-2z' },
  rotate: { d: 'M7 2h8a2 2 0 0 1 2 2v7h-2V4H7v16h4v2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 12h5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zm0 2v4h5v-4z', eo: true },
  book: { d: 'M2 4h7.5A3.5 3.5 0 0 1 12 5.1 3.5 3.5 0 0 1 14.5 4H22v16h-7.5a1.5 1.5 0 0 0-1.5 1.5h-2A1.5 1.5 0 0 0 9.5 20H2zm2 2v12h5.5c.5 0 1 .1 1.5.3V7.5A1.5 1.5 0 0 0 9.5 6zm10.5 0A1.5 1.5 0 0 0 13 7.5v10.8c.5-.2 1-.3 1.5-.3H20V6z', eo: true },
  // 观战 (spectator seats; the same eye as gameComponents.js GIcon 'eye')
  eye: { d: 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z', eo: true },
};

/**
 * Inline SVG icon.
 * @param {{ name: keyof typeof ICONS, size?: string, class?: string, title?: string }} props
 */
export function Icon({ name, size, class: cls, title }) {
  const ic = ICONS[name];
  if (!ic) return null;
  return html`<svg class=${cx('icon', cls)} viewBox="0 0 24 24" width=${size || '1em'} height=${size || '1em'}
    aria-hidden=${title ? undefined : 'true'} role=${title ? 'img' : undefined} focusable="false">
    ${title ? html`<title>${title}</title>` : null}
    <path d=${ic.d} fill-rule=${ic.eo ? 'evenodd' : undefined} />
  </svg>`;
}

// ---- small primitives ------------------------------------------------------------------------

/** Tiny uppercase techno label (e.g. "RHODES ISLAND // STRONGHOLD PROTOCOL"). */
export function MicroLabel({ children, class: cls, tone }) {
  return html`<span class=${cx('micro', tone && `micro--${tone}`, cls)}>${children}</span>`;
}

/**
 * Row of chevrons (»»») with an optional flowing animation.
 * @param {{ count?: number, dir?: 'right'|'left', tone?: string, animated?: boolean, class?: string }} props
 */
export function Chevrons({ count = 3, dir = 'right', tone = 'mint', animated = true, class: cls }) {
  const n = Math.max(1, Math.min(8, count | 0));
  return html`<span class=${cx('chevrons', `chevrons--${tone}`, dir === 'left' && 'chevrons--left', animated && 'is-animated', cls)} aria-hidden="true">
    ${Array.from({ length: n }, (_, i) => html`<svg key=${i} viewBox="0 0 12 20" style=${`--i:${dir === 'left' ? n - 1 - i : i}`}><path d="M0 0h5l7 10-7 10H0l7-10z" /></svg>`)}
  </span>`;
}

// ---- Button ------------------------------------------------------------------------------------

/**
 * Button. `loading` (a request in flight): disabled and dimmed, and after a short delay a thin bar sweeps along its
 * bottom edge (css .btn__busy) — never a spinning ring or a wait cursor, which read as "this text is still loading from
 * the server" (user playtest #3 item 9); the icon stays.
 * @param {{ variant?: 'primary'|'secondary'|'danger'|'amber'|'ice'|'ghost', size?: 'sm'|'md'|'lg'|'xl',
 *   icon?: string, iconRight?: string, loading?: boolean, disabled?: boolean, block?: boolean, square?: boolean,
 *   active?: boolean, onClick?: Function, type?: string, title?: string, class?: string, children?: any }} props
 */
export function Button({
  variant = 'secondary', size = 'md', icon, iconRight, loading = false, disabled = false, block = false,
  square = false, active = false, onClick, type = 'button', title, class: cls, children, ...rest
}) {
  const isDisabled = disabled || loading;
  return html`<button type=${type} title=${title}
    class=${cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', square && 'btn--square',
      active && 'is-active', loading && 'is-loading', cls)}
    disabled=${isDisabled} aria-busy=${loading ? 'true' : undefined} aria-pressed=${active ? 'true' : undefined}
    onClick=${(e) => { if (!isDisabled && onClick) onClick(e); }} ...${rest}>
    ${icon ? html`<${Icon} name=${icon} class="btn__icon" />` : null}
    ${children != null && children !== false ? html`<span class="btn__label">${children}</span>` : null}
    ${iconRight ? html`<${Icon} name=${iconRight} class="btn__icon btn__icon--right" />` : null}
    ${loading ? html`<span class="btn__busy" aria-hidden="true"></span>` : null}
  </button>`;
}

// ---- Panel -------------------------------------------------------------------------------------

/**
 * Framed panel with bracket corners, optional header (title + micro label) and actions.
 * @param {{ title?: any, micro?: string, tone?: string, brackets?: boolean, glow?: boolean, pad?: boolean,
 *   actions?: any, class?: string, children?: any, as?: string }} props
 */
export function Panel({ title, micro, tone = 'mint', brackets = true, glow = false, pad = true, actions, class: cls, children, ...rest }) {
  return html`<section class=${cx('panel', `panel--${tone}`, brackets && 'brackets', glow && 'panel--glow', !pad && 'panel--flush', cls)} ...${rest}>
    ${title || micro || actions ? html`<header class="panel__head">
      <div class="panel__titles">
        ${micro ? html`<${MicroLabel}>${micro}<//>` : null}
        ${title ? html`<h2 class="panel__title">${title}</h2>` : null}
      </div>
      ${actions ? html`<div class="panel__actions">${actions}</div>` : null}
    </header>` : null}
    <div class="panel__body">${children}</div>
  </section>`;
}

// ---- badges & chips ----------------------------------------------------------------------------

/**
 * Hexagon badge (prices, costs, funds). Width grows with content.
 * @param {{ value?: any, tone?: 'gold'|'mint'|'red'|'amber'|'ice'|'dark'|'discount'|'premium', size?: 'sm'|'md'|'lg',
 *   icon?: string, class?: string, title?: string }} props
 */
export function HexBadge({ value, tone = 'gold', size = 'md', icon, class: cls, title, children }) {
  return html`<span class=${cx('hex', `hex--${tone}`, `hex--${size}`, cls)} title=${title}>
    <span class="hex__fill">
      ${icon ? html`<${Icon} name=${icon} class="hex__icon" />` : null}
      <span class="hex__value">${value ?? children}</span>
    </span>
  </span>`;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** @param {number} n 1..10 @returns {string} roman numeral ('' when out of range) */
export const roman = (n) => ROMAN[n | 0] || '';

/**
 * Official tier chip sprite URL (web manifest `shopCard/img_chess_level_N`, else the local-client
 * `ui/battle/img_chess_level_N`), or null (CSS fallback).
 * @param {number} t 1..6
 */
export function tierChipUrl(t) {
  return uiUrl(data.get('assets'), `shopCard/img_chess_level_${t}`) || localAsset('ui/battle', `img_chess_level_${t}`);
}

/**
 * Roman tier chip (I–VI): the official octagon sprite, or a CSS octagon in the official tier colours.
 * Golden = elite (精锐) variant (gold glow).
 * @param {{ tier: number, golden?: boolean, size?: 'sm'|'md'|'lg', class?: string }} props
 */
export function TierChip({ tier, golden = false, size = 'md', class: cls }) {
  const n = Math.max(1, Math.min(6, Number(tier) | 0 || 1));
  const src = tierChipUrl(n);
  const [bad, setBad] = useState(null);
  const img = !!src && bad !== src;
  return html`<span class=${cx('tier', `tier--${n}`, `tier--${size}`, golden && 'tier--golden', img && 'tier--img', cls)} aria-label=${t('{tier}阶', { tier: n })}>
    ${img ? html`<img src=${src} alt="" draggable=${false} onError=${() => setBad(src)} />` : roman(n)}
  </span>`;
}

/**
 * Bond disc: round glyph disc with segmented tier ring, stack count and name.
 * @param {{ name?: string, icon?: string, count?: number, layers?: number, tier?: number, maxTier?: number,
 *   active?: boolean, disabled?: boolean, layersDisabled?: boolean, size?: 'sm'|'md'|'lg', showName?: boolean,
 *   onClick?: Function, class?: string, title?: string }} props
 */
export function BondDisc({
  name = '', icon, count, layers, tier = 0, maxTier = 3, active = false, disabled = false, layersDisabled = false,
  size = 'md', showName = true, onClick, class: cls, title,
}) {
  // Remember which URL failed (a per-URL flag can't race a reset effect).
  const [badSrc, setBadSrc] = useState(null);
  const imgOk = !!icon && badSrc !== icon;
  const n = Math.max(1, Math.min(8, maxTier | 0 || 3));
  const filled = Math.max(0, Math.min(n, tier | 0));
  const R = 46;
  const C = 2 * Math.PI * R;
  const gap = n > 1 ? 5 : 0;
  const seg = C / n - gap;
  const stack = layers ?? count;
  const glyph = (name || '?').trim().charAt(0) || '?';
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} type=${onClick ? 'button' : undefined}
      class=${cx('bond', `bond--${size}`, active && 'is-active', disabled && 'is-disabled', layersDisabled && 'is-frozen', onClick && 'is-clickable', cls)}
      onClick=${onClick} title=${title || name}>
    <span class="bond__disc">
      <svg class="bond__ring" viewBox="-50 -50 100 100" aria-hidden="true">
        ${Array.from({ length: n }, (_, i) => html`<circle key=${i} r=${R}
          class=${i < filled ? 'on' : 'off'} stroke-dasharray=${`${seg} ${C - seg}`}
          stroke-dashoffset=${-(i * C) / n - gap / 2} transform="rotate(-90)" />`)}
      </svg>
      <span class="bond__core">
        ${imgOk
          ? html`<img class="bond__icon" src=${icon} alt="" draggable=${false} onError=${() => setBadSrc(icon)} />`
          : html`<span class="bond__glyph">${glyph}</span>`}
      </span>
      ${stack != null ? html`<span class="bond__count">${stack}</span>` : null}
      ${disabled ? html`<span class="bond__ban" aria-label=${t('禁用')}><${Icon} name="close" /></span>` : null}
    </span>
    ${showName && name ? html`<span class="bond__name">${name}</span>` : null}
  <//>`;
}

// ---- seven-segment display & countdown ---------------------------------------------------------

const SEG_W = 56;
const SEG_H = 100;
const SEG_T = 12;
const SEG_GAP = 2.2;
const pts = (arr) => arr.map(([x, y]) => `${x},${y}`).join(' ');
function hSeg(y) {
  const t = SEG_T / 2;
  const x1 = t + SEG_GAP;
  const x2 = SEG_W - t - SEG_GAP;
  return pts([[x1, y], [x1 + t, y - t], [x2 - t, y - t], [x2, y], [x2 - t, y + t], [x1 + t, y + t]]);
}
function vSeg(x, y1, y2) {
  const t = SEG_T / 2;
  return pts([[x, y1], [x + t, y1 + t], [x + t, y2 - t], [x, y2], [x - t, y2 - t], [x - t, y1 + t]]);
}
const SEG_POLYS = (() => {
  const t = SEG_T / 2;
  const mid = SEG_H / 2;
  return {
    a: hSeg(t), g: hSeg(mid), d: hSeg(SEG_H - t),
    f: vSeg(t, t + SEG_GAP, mid - SEG_GAP), e: vSeg(t, mid + SEG_GAP, SEG_H - t - SEG_GAP),
    b: vSeg(SEG_W - t, t + SEG_GAP, mid - SEG_GAP), c: vSeg(SEG_W - t, mid + SEG_GAP, SEG_H - t - SEG_GAP),
  };
})();
const SEG_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const DIGIT_SEGS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  '-': 'g', ' ': '', _: 'd', A: 'abcefg', b: 'cdefg', C: 'adef', d: 'bcdeg', E: 'adefg', F: 'aefg', H: 'bcefg', L: 'def', P: 'abefg', o: 'cdeg', r: 'eg', U: 'bcdef',
};

function SegChar({ ch }) {
  if (ch === ':') {
    return html`<svg class="seg__char seg__char--colon" viewBox="0 0 20 100" aria-hidden="true">
      <rect class="on" x="4" y="26" width="12" height="12" /><rect class="on" x="4" y="62" width="12" height="12" /></svg>`;
  }
  const on = DIGIT_SEGS[ch] ?? '';
  return html`<svg class="seg__char" viewBox=${`-4 -2 ${SEG_W + 8} ${SEG_H + 4}`} aria-hidden="true">
    <g transform="skewX(-7) translate(6 0)">
      ${SEG_ORDER.map((s) => html`<polygon key=${s} points=${SEG_POLYS[s]} class=${on.includes(s) ? 'on' : 'off'} />`)}
    </g></svg>`;
}

/**
 * Seven-segment text (digits, '-', ':' and a few letters).
 * @param {{ text: string|number, tone?: 'mint'|'orange'|'gold'|'red'|'ice', size?: string, class?: string, flicker?: boolean }} props
 *   size = CSS height (default via --seg-h)
 */
export function SevenSeg({ text, tone = 'mint', size, class: cls, flicker = false }) {
  const s = String(text ?? '');
  return html`<span class=${cx('seg', `seg--${tone}`, flicker && 'is-flicker', cls)} style=${size ? `--seg-h:${size}` : undefined}
      role="img" aria-label=${s}>
    ${[...s].map((ch, i) => html`<${SegChar} key=${i} ch=${ch} />`)}
  </span>`;
}

// Shared ticker so every live countdown re-renders from one interval per period.
const tickers = new Map(); // ms -> { subs:Set, id }
/**
 * Re-render the calling component every `ms` milliseconds (0/undefined = never).
 * @param {number} ms
 */
export function useTicker(ms) {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    if (!(ms > 0)) return undefined;
    let tk = tickers.get(ms);
    if (!tk) {
      tk = { subs: new Set(), id: null };
      tk.id = setInterval(() => { for (const fn of [...tk.subs]) fn(); }, ms);
      tickers.set(ms, tk);
    }
    tk.subs.add(force);
    return () => {
      tk.subs.delete(force);
      if (tk.subs.size === 0) { clearInterval(tk.id); tickers.delete(ms); }
    };
  }, [ms]);
}

/**
 * Whether a server deadline is set (servers send 0 / null for untimed phases).
 * @param {any} deadline
 * @returns {boolean}
 */
export const hasDeadline = (deadline) => Number.isFinite(deadline) && deadline > 0;

/**
 * Seconds left until a server deadline (ceil, ≥ 0), or null when there is no deadline (null / 0).
 * @param {number|null|undefined} deadline server epoch ms
 * @returns {number|null}
 */
export function secondsLeft(deadline) {
  if (!hasDeadline(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - serverNow()) / 1000));
}

/**
 * 7-segment countdown with "COUNTDOWN" micro label and a 5-bar gauge; turns orange ≤ warnAt s.
 * Untimed (no `seconds` and no deadline — the server sends deadline 0 for every phase outside the battles of a solo
 * match, Match.soloUntimed): renders nothing at all. It used to draw a "--" placeholder with the COUNTDOWN label,
 * which reads as a timer (user playtest #4 item 3; css/screens/loadout.css keeps hiding the old placeholder).
 * @param {{ deadline?: number, seconds?: number, total?: number, warnAt?: number, label?: string,
 *   size?: 'sm'|'md'|'lg', gauge?: boolean, onExpire?: Function, class?: string }} props
 *   deadline: server epoch ms (live); seconds: static value (overrides deadline); total: seconds for the gauge.
 */
export function Countdown({ deadline, seconds, total, warnAt = 10, label = 'COUNTDOWN', size = 'md', gauge = true, onExpire, class: cls }) {
  const live = seconds == null && hasDeadline(deadline);
  useTicker(live ? 200 : 0);
  const remain = seconds != null && Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : live ? secondsLeft(deadline) : null;
  const warn = remain != null && remain <= warnAt;
  const text = remain == null ? '--' : String(Math.min(999, remain)).padStart(2, '0');
  const bars = 5;
  const lit = remain == null ? 0 : Number.isFinite(total) && total > 0 ? Math.max(0, Math.min(bars, Math.ceil((remain / total) * bars))) : bars;

  const expiredFor = useRef(null);
  useEffect(() => {
    if (!onExpire || !live) return;
    if (remain === 0 && expiredFor.current !== deadline) {
      expiredFor.current = deadline;
      onExpire();
    }
  });

  // untimed phase: no timer on screen (hooks above run unconditionally, so the component may toggle freely)
  if (remain == null) return null;
  return html`<div class=${cx('countdown', `countdown--${size}`, warn && 'is-warn', cls)} role="timer" aria-label=${remain == null ? t('无倒计时') : t('剩余{remain}秒', { remain })}>
    <div class="countdown__main">
      <${SevenSeg} text=${text} tone=${warn ? 'orange' : 'mint'} flicker=${warn && remain > 0} />
      ${label ? html`<span class="countdown__label">${label}</span>` : null}
    </div>
    ${gauge ? html`<div class="countdown__gauge" aria-hidden="true">
      ${Array.from({ length: bars }, (_, i) => html`<i key=${i} class=${bars - i <= lit ? 'on' : ''}></i>`)}
    </div>` : null}
  </div>`;
}

// ---- Modal & dialogs ---------------------------------------------------------------------------

const modalStack = []; // open modals, topmost last: only the topmost reacts to Escape

/**
 * Modal dialog (declarative). Esc / backdrop click call onClose.
 * @param {{ open: boolean, title?: any, micro?: string, tone?: string, onClose?: Function, actions?: any,
 *   width?: string, closeOnBackdrop?: boolean, class?: string, children?: any }} props
 */
export function Modal({ open, title, micro, tone = 'mint', onClose, actions, width, closeOnBackdrop = true, class: cls, children }) {
  const boxRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const token = {};
    modalStack.push(token);
    const prevFocus = typeof document !== 'undefined' ? document.activeElement : null;
    const onKey = (e) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== token || !closeRef.current) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      const el = boxRef.current?.querySelector('[data-autofocus]') || boxRef.current?.querySelector('button, input');
      el?.focus?.();
    }, 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
      const i = modalStack.indexOf(token);
      if (i >= 0) modalStack.splice(i, 1);
      prevFocus?.focus?.();
    };
  }, [open]);
  const [mounted, closing] = useExitTransition(open, 180); // one exit beat when open goes false
  if (!mounted) return null;
  return html`<div class=${`modal${closing ? ' is-closing' : ''}`} role="presentation"
      onMouseDown=${(e) => { if (closeOnBackdrop && e.target === e.currentTarget && onClose) onClose(); }}>
    <div ref=${boxRef} class=${cx('modal__box', 'brackets', `modal__box--${tone}`, cls)} role="dialog" aria-modal="true"
         style=${width ? `width:${width}` : undefined}>
      <div class="modal__stripe" aria-hidden="true"></div>
      ${title || micro ? html`<header class="modal__head">
        ${micro ? html`<${MicroLabel}>${micro}<//>` : null}
        ${title ? html`<h2 class="modal__title">${title}</h2>` : null}
      </header>` : null}
      <div class="modal__body">${children}</div>
      ${actions ? html`<footer class="modal__actions">${actions}</footer>` : null}
    </div>
  </div>`;
}

/**
 * Keep a surface mounted for one exit beat after `open` goes false: its CSS `is-closing` animation
 * plays instead of an instant unmount. Returns [mounted, closing].
 * @param {boolean} open @param {number} [ms] exit beat in ms
 */
export function useExitTransition(open, ms = 180) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); return undefined; }
    if (!mounted) return undefined;
    setClosing(true);
    const t = setTimeout(() => { setMounted(false); setClosing(false); }, ms);
    return () => clearTimeout(t);
  }, [open, mounted, ms]);
  return [mounted, closing];
}

let dialogSeq = 0;
let dialogs = [];
const dialogListeners = new Set();
const emitDialogs = () => { for (const fn of [...dialogListeners]) fn(); };

function openDialog(opts, kind) {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { id: ++dialogSeq, kind, opts: opts || {}, resolve }];
    emitDialogs();
  });
}
function closeDialog(id, result) {
  const d = dialogs.find((x) => x.id === id);
  if (!d) return;
  dialogs = dialogs.filter((x) => x.id !== id);
  emitDialogs();
  try { d.resolve(result); } catch { /* ignore */ }
}

/**
 * Imperative confirm dialog (requires <UiHosts/> or <DialogHost/> mounted).
 * @param {{ title?: string, text?: any, okText?: string, cancelText?: string, tone?: string, danger?: boolean, micro?: string }} opts
 * @returns {Promise<boolean>}
 */
export const confirmDialog = (opts) => openDialog(opts, 'confirm');
/**
 * Imperative alert dialog.
 * @param {{ title?: string, text?: any, okText?: string, tone?: string, micro?: string }} opts
 * @returns {Promise<true>}
 */
export const alertDialog = (opts) => openDialog(opts, 'alert');

/**
 * Dismiss every queued imperative dialog (confirm → false, alert → true) — e.g. the server session was reset and the
 * screen they belonged to is gone.
 */
export function closeAllDialogs() {
  const all = dialogs;
  if (!all.length) return;
  dialogs = [];
  emitDialogs();
  for (const d of all) { try { d.resolve(d.kind !== 'confirm'); } catch { /* ignore */ } }
}

/** Renders queued imperative dialogs (one at a time). */
export function DialogHost() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    dialogListeners.add(force);
    return () => dialogListeners.delete(force);
  }, []);
  const d = dialogs[0];
  if (!d) return null;
  const { title = t('确认'), text, okText = t('确认'), cancelText = t('取消'), tone, danger, micro = 'CONFIRMATION' } = d.opts;
  const isConfirm = d.kind === 'confirm';
  // Enter confirms unless a specific button has focus (then the native click decides).
  const onKey = (e) => {
    if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON') { e.preventDefault(); closeDialog(d.id, true); }
  };
  return html`<div onKeyDown=${onKey}>
    <${Modal} key=${d.id} open=${true} title=${title} micro=${micro} tone=${tone || (danger ? 'red' : 'mint')}
      onClose=${() => closeDialog(d.id, isConfirm ? false : true)}
      actions=${html`
        ${isConfirm ? html`<${Button} variant="secondary" onClick=${() => closeDialog(d.id, false)}>${cancelText}<//>` : null}
        <${Button} variant=${danger ? 'danger' : 'primary'} icon="check" data-autofocus onClick=${() => closeDialog(d.id, true)}>${okText}<//>`}>
      ${typeof text === 'string' ? html`<p class="modal__text">${text}</p>` : text}
    <//>
  </div>`;
}

// ---- Tooltip -----------------------------------------------------------------------------------

let tipState = null; // { id, content, rect, placement }
let tipSeq = 0;
const tipListeners = new Set();
const setTip = (s) => { tipState = s; for (const fn of [...tipListeners]) fn(); };

/**
 * Hover/focus tooltip around its children. Content renders in <TooltipLayer/> (fixed, viewport-clamped).
 * @param {{ text: any, placement?: 'top'|'bottom', delay?: number, block?: boolean, class?: string, children?: any }} props
 */
const TOUCH_TIP_MS = 450;

export function Tooltip({ text, placement = 'top', delay = 120, block = false, class: cls, children }) {
  const ref = useRef(null);
  const idRef = useRef(0);
  const timer = useRef(null);
  const textRef = useRef(text);
  const pressed = useRef(false); // pointer pressed inside: the focus that follows is not a keyboard focus
  textRef.current = text;
  if (!idRef.current) idRef.current = ++tipSeq;
  const show = () => {
    clearTimeout(timer.current);
    if (textRef.current == null || textRef.current === '') return;
    timer.current = setTimeout(() => {
      const el = ref.current;
      const content = textRef.current; // the text of the render current when the delay ends (a click may change it)
      if (!el || !el.isConnected || content == null || content === '') return;
      setTip({ id: idRef.current, content, rect: el.getBoundingClientRect(), placement });
    }, delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (tipState?.id === idRef.current) setTip(null);
  };
  // A click hides the tooltip until the pointer leaves: the focus it gives the button must not bring it back
  // (with the text of the click's closure) over whatever the click opened. Keyboard focus still shows it.
  // Touch: a tap never shows it (the compatibility mouseenter that follows a tap is ignored); a long press
  // (≥ 450 ms) does, and it goes away shortly after the finger lifts.
  const touchAt = useRef(0);
  const longTimer = useRef(null);
  const onPointerDown = (e) => {
    pressed.current = true;
    hide();
    clearTimeout(longTimer.current);
    if (e && e.pointerType && e.pointerType !== 'mouse') {
      touchAt.current = Date.now();
      longTimer.current = setTimeout(() => { pressed.current = false; show(); }, TOUCH_TIP_MS);
    }
  };
  const onPointerEnd = (e) => {
    if (!e || e.pointerType === 'mouse') return;
    touchAt.current = Date.now();
    clearTimeout(longTimer.current);
    if (tipState?.id === idRef.current) { clearTimeout(timer.current); timer.current = setTimeout(hide, 1600); }
  };
  const onMouseEnter = () => { if (Date.now() - touchAt.current > 900) show(); };
  const onFocusIn = () => { if (!pressed.current && Date.now() - touchAt.current > 900) show(); };
  const onLeave = () => { pressed.current = false; if (Date.now() - touchAt.current > 900) hide(); };
  useEffect(() => () => { clearTimeout(longTimer.current); hide(); }, []);
  // Keep the visible tooltip's content fresh when `text` changes (and hide it when text goes away).
  useEffect(() => {
    if (tipState?.id !== idRef.current) return;
    if (text == null || text === '') setTip(null);
    else setTip({ ...tipState, content: text });
  }, [text]);
  return html`<span ref=${ref} class=${cx('tt-anchor', block && 'tt-anchor--block', cls)}
      onMouseEnter=${onMouseEnter} onMouseLeave=${onLeave} onFocusIn=${onFocusIn} onFocusOut=${onLeave} onPointerDown=${onPointerDown}
      onPointerUp=${onPointerEnd} onPointerCancel=${onPointerEnd} onContextMenu=${(e) => { if (Date.now() - touchAt.current < 900) e.preventDefault(); }}>
    ${children}
  </span>`;
}

/** Renders the active tooltip. Mount once (UiHosts does). */
export function TooltipLayer() {
  const [, force] = useReducer((c) => c + 1, 0);
  const boxRef = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    tipListeners.add(force);
    return () => tipListeners.delete(force);
  }, []);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!tipState || !el) { if (pos) setPos(null); return; }
    const r = tipState.rect;
    const b = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 8;
    let place = tipState.placement;
    let top = place === 'bottom' ? r.bottom + m : r.top - b.height - m;
    if (place === 'top' && top < m) { place = 'bottom'; top = r.bottom + m; }
    if (place === 'bottom' && top + b.height > vh - m) { place = 'top'; top = Math.max(m, r.top - b.height - m); }
    let left = r.left + r.width / 2 - b.width / 2;
    left = Math.max(m, Math.min(vw - b.width - m, left));
    const next = { top: Math.round(top), left: Math.round(left), place, id: tipState.id };
    if (!pos || pos.top !== next.top || pos.left !== next.left || pos.id !== next.id || pos.place !== next.place) setPos(next);
  });
  if (!tipState) return null;
  const ready = pos && pos.id === tipState.id;
  return html`<div ref=${boxRef} class=${cx('tooltip', ready && 'is-shown', ready && `tooltip--${pos.place}`)} role="tooltip"
    style=${ready ? `top:${pos.top}px;left:${pos.left}px` : 'top:-9999px;left:-9999px'}>${tipState.content}</div>`;
}

// ---- ProgressBar, Tabs, Spinner ----------------------------------------------------------------

/**
 * Progress bar.
 * @param {{ value: number, max?: number, tone?: 'mint'|'gold'|'amber'|'orange'|'red'|'ice', segments?: number,
 *   label?: any, showValue?: boolean, size?: 'sm'|'md'|'lg', class?: string }} props
 */
export function ProgressBar({ value, max = 100, tone = 'mint', segments = 0, label, showValue = false, size = 'md', class: cls }) {
  const m = Number.isFinite(max) && max > 0 ? max : 100;
  const v = Number.isFinite(value) ? Math.max(0, Math.min(m, value)) : 0;
  const pct = (v / m) * 100;
  return html`<div class=${cx('pbar', `pbar--${tone}`, `pbar--${size}`, cls)}>
    ${label != null || showValue ? html`<div class="pbar__meta">
      <span class="pbar__label">${label}</span>
      ${showValue ? html`<span class="pbar__value">${Math.round(v)}<small>/${Math.round(m)}</small></span>` : null}
    </div>` : null}
    <div class="pbar__track" role="progressbar" aria-valuemin="0" aria-valuemax=${m} aria-valuenow=${v}
         style=${segments > 1 ? `--segs:${segments}` : undefined}>
      <div class="pbar__fill" style=${`--fill:${pct}%`}></div>
      ${segments > 1 ? html`<div class="pbar__segs"></div>` : null}
    </div>
  </div>`;
}

/**
 * Tabs (controlled).
 * @param {{ items: {id: string, label: any, badge?: any, disabled?: boolean}[], value: string,
 *   onChange: (id: string) => void, size?: 'sm'|'md', class?: string }} props
 */
export function Tabs({ items = [], value, onChange, size = 'md', class: cls }) {
  const onKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.id === value);
    if (idx < 0 || enabled.length === 0) return;
    const next = enabled[(idx + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
    onChange?.(next.id);
    e.preventDefault();
  };
  return html`<div class=${cx('tabs', `tabs--${size}`, cls)} role="tablist" onKeyDown=${onKey}>
    ${items.map((it) => html`<button key=${it.id} type="button" role="tab" aria-selected=${it.id === value ? 'true' : 'false'}
        tabIndex=${it.id === value ? 0 : -1} disabled=${it.disabled}
        class=${cx('tabs__tab', it.id === value && 'is-active')} onClick=${() => !it.disabled && onChange?.(it.id)}>
      <span>${it.label}</span>
      ${it.badge != null ? html`<span class="tabs__badge">${it.badge}</span>` : null}
    </button>`)}
  </div>`;
}

/**
 * Loading spinner (rotating hexagon).
 * @param {{ size?: 'sm'|'md'|'lg', label?: any, tone?: string, class?: string }} props
 */
export function Spinner({ size = 'md', label, tone = 'mint', class: cls }) {
  return html`<span class=${cx('spinner', `spinner--${size}`, `spinner--${tone}`, cls)} role="status">
    <svg viewBox="0 0 50 50" aria-hidden="true">
      <polygon class="spinner__track" points="25,3 44,14 44,36 25,47 6,36 6,14" />
      <polygon class="spinner__arc" points="25,3 44,14 44,36 25,47 6,36 6,14" />
    </svg>
    ${label ? html`<span class="spinner__label">${label}</span>` : html`<span class="sr-only">${t('加载中')}</span>`}
  </span>`;
}

// ---- Avatar frame ------------------------------------------------------------------------------

const SEAT_HUES = [162, 196, 38, 280];
/**
 * Square avatar frame with bracket corners. Falls back to a glyph (first letter / robot).
 * @param {{ name?: string, src?: string, size?: 'sm'|'md'|'lg'|'xl', seat?: number, host?: boolean, bot?: boolean,
 *   self?: boolean, ready?: boolean, offline?: boolean, dead?: boolean, empty?: boolean, class?: string }} props
 */
export function AvatarFrame({ name = '', src, size = 'md', seat = 0, host, bot, self, ready, offline, dead, empty, class: cls }) {
  const [badSrc, setBadSrc] = useState(null);
  const imgOk = !!src && badSrc !== src;
  const hue = SEAT_HUES[((seat | 0) % 4 + 4) % 4];
  const glyph = [...(name || '').trim()][0] || '?';
  return html`<div class=${cx('avatar', `avatar--${size}`, 'brackets', host && 'is-host', bot && 'is-bot', self && 'is-self',
      ready && 'is-ready', offline && 'is-offline', dead && 'is-dead', empty && 'is-empty', cls)} style=${`--seat-hue:${hue}`}>
    <div class="avatar__img">
      ${empty ? html`<${Icon} name="plus" class="avatar__empty" />`
        : imgOk ? html`<img src=${src} alt="" draggable=${false} onError=${() => setBadSrc(src)} />`
        : bot ? html`<${Icon} name="robot" class="avatar__bot" />`
        : html`<span class="avatar__glyph">${glyph}</span>`}
    </div>
    ${host ? html`<span class="avatar__badge avatar__badge--host" title=${t('创建者')}><${Icon} name="crown" /></span>` : null}
    ${self ? html`<span class="avatar__badge avatar__badge--self" title=${t('你')}><${Icon} name="user" /></span>` : null}
    ${bot && !empty ? html`<span class="avatar__tag">AI</span>` : null}
  </div>`;
}

// ---- PhaseBanner -------------------------------------------------------------------------------

/**
 * Chevron phase banner (full-width strip that wipes in horizontally).
 * @param {{ title: any, sub?: any, micro?: string, tone?: 'mint'|'orange'|'red'|'gold'|'ice', mode?: 'overlay'|'inline',
 *   duration?: number, onDone?: Function, class?: string }} props
 *   mode 'overlay' = fixed over the screen; duration (ms) > 0 auto-hides then calls onDone. Re-key to replay.
 */
export function PhaseBanner({ title, sub, micro, tone = 'mint', mode = 'inline', duration = 0, onDone, class: cls }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!(duration > 0)) return undefined;
    const t1 = setTimeout(() => setLeaving(true), duration);
    const t2 = setTimeout(() => { setGone(true); onDone?.(); }, duration + 260);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [duration]);
  if (gone) return null;
  return html`<div class=${cx('pbanner', `pbanner--${tone}`, `pbanner--${mode}`, leaving && 'is-leaving', cls)} role="status" aria-live="polite">
    <div class="pbanner__band">
      <${Chevrons} count=${4} tone=${tone} class="pbanner__chev pbanner__chev--l" />
      <div class="pbanner__text">
        ${micro ? html`<span class="pbanner__micro">${micro}</span>` : null}
        <span class="pbanner__title">${title}</span>
        ${sub ? html`<span class="pbanner__sub">${sub}</span>` : null}
      </div>
      <${Chevrons} count=${4} tone=${tone} dir="left" class="pbanner__chev pbanner__chev--r" />
    </div>
  </div>`;
}

/**
 * The round's result box (the official round result dialog, shown at settlement; GitHub #235, PR #112 by @Convey123):
 * a centred framed plate — tone-coloured frame and corner ticks, chevrons either side of the title — that opens, holds
 * `duration` ms and closes by itself. Purely presentational: ui/gameLogic/phases.js (roundResultBox / uniteResultBox /
 * battleResultBox) picks the words, screens/game.js the moment (SETTLE). `pointer-events: none`: it never takes a click.
 * @param {{ title: any, sub?: any, micro?: string, tone?: 'mint'|'orange'|'red', duration?: number, onDone?: Function }} props
 *   duration (ms) > 0 auto-hides then calls onDone. Re-key to replay.
 */
export function ResultDialog({ title, sub, micro, tone = 'mint', duration = 2800, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!(duration > 0)) return undefined;
    const t1 = setTimeout(() => setLeaving(true), duration);
    const t2 = setTimeout(() => { setGone(true); onDone?.(); }, duration + 300);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [duration]);
  if (gone) return null;
  return html`<div class=${cx('rdialog', `rdialog--${tone}`, leaving && 'is-leaving')} role="status" aria-live="polite">
    <div class="rdialog__box">
      <span class="rdialog__tick rdialog__tick--tl"></span><span class="rdialog__tick rdialog__tick--tr"></span>
      <span class="rdialog__tick rdialog__tick--bl"></span><span class="rdialog__tick rdialog__tick--br"></span>
      ${micro ? html`<span class="rdialog__micro">${micro}</span>` : null}
      <div class="rdialog__row">
        <${Chevrons} count=${3} tone=${tone} class="rdialog__chev" />
        <span class="rdialog__title">${title}</span>
        <${Chevrons} count=${3} tone=${tone} dir="left" class="rdialog__chev" />
      </div>
      ${sub ? html`<span class="rdialog__sub">${sub}</span>` : null}
    </div>
  </div>`;
}

// ---- domain helpers ----------------------------------------------------------------------------

/**
 * Stable 4-digit "博士 #1234" tag for a player id (FNV-1a hash; ids themselves are opaque strings).
 * @param {any} id
 * @returns {string}
 */
export function doctorNo(id) {
  let h = 2166136261;
  for (const ch of String(id ?? '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return String(h % 10000).padStart(4, '0');
}

/**
 * Latency pill ("58ms"), coloured by research 06 §3.4 tiers (<60 mint, <200 amber, else red).
 * @param {{ ms?: number|null, online?: boolean, class?: string }} props
 */
export function PingPill({ ms, online = true, class: cls }) {
  const ok = online && Number.isFinite(ms);
  const tier = !ok ? 'off' : ms < 60 ? 'low' : ms < 200 ? 'medium' : 'high';
  return html`<span class=${cx('ping', `ping--${tier}`, cls)} title=${ok ? t('当前延迟 {ms}ms', { ms }) : t('未连接')}>
    <${Icon} name=${ok ? 'signal' : 'wifiOff'} class="ping__icon" />
    <span class="ping__value">${ok ? Math.min(9999, Math.round(ms)) : '--'}</span><span class="ping__unit">ms</span>
  </span>`;
}

/**
 * Official difficulty glyph (data/assets.json `ui['modeIcon/mode_<difficulty>_icon']`: rook, rook +
 * swords, castle + swords, castle + warning) — the SVG rook while assets are missing or fail to load.
 * Rendered with class "icon" so it sizes like an <Icon/>.
 * @param {{ difficulty: string, class?: string }} props
 */
export function DifficultyIcon({ difficulty, class: cls }) {
  useData('assets');
  const [badSrc, setBadSrc] = useState(null);
  const ui = DIFFICULTY_NAMES[difficulty] ? data.get('assets')?.ui : null;
  const src = ui && typeof ui === 'object' ? ui[`modeIcon/mode_${String(difficulty).toLowerCase()}_icon`] : null;
  if (typeof src === 'string' && src && badSrc !== src) {
    return html`<img class=${cx('icon', 'dicon', cls)} src=${src} alt="" draggable=${false} onError=${() => setBadSrc(src)} />`;
  }
  return html`<${Icon} name="rook" class=${cls} />`;
}

/**
 * Difficulty tag: coloured glyph + name (标准/险境/绝境/终极模拟).
 * @param {{ difficulty: string, size?: 'sm'|'md'|'lg', class?: string, code?: string }} props
 */
export function DifficultyTag({ difficulty, size = 'md', class: cls, code }) {
  const name = DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : difficulty || '—';
  const color = DIFFICULTY_COLORS[difficulty] || 'var(--text-lo)';
  return html`<span class=${cx('dtag', `dtag--${size}`, cls)} style=${`--d-color:${color}`}>
    <${DifficultyIcon} difficulty=${difficulty} class="dtag__icon" />
    <span class="dtag__name">${name}</span>
    ${code ? html`<span class="dtag__code">${code}</span>` : null}
  </span>`;
}

/**
 * Bracketed text input.
 * @param {{ label?: any, micro?: string, value: string, onInput: (v: string) => void, onEnter?: Function,
 *   placeholder?: string, maxLength?: number, transform?: (v: string) => string, autoFocus?: boolean,
 *   disabled?: boolean, size?: 'md'|'lg'|'code', icon?: string, class?: string, inputRef?: any, name?: string }} props
 */
export function TextField({ label, micro, value, onInput, onEnter, placeholder, maxLength, transform, autoFocus, disabled, size = 'md', icon, class: cls, inputRef, name, hint, invalid }) {
  const localRef = useRef(null);
  const ref = inputRef || localRef;
  const composing = useRef(false);
  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus(), 60);
  }, []);
  const handle = (e) => {
    let v = e.currentTarget.value;
    if (!composing.current && transform) {
      const t = transform(v);
      if (t !== v) { v = t; e.currentTarget.value = t; }
    }
    onInput?.(v);
  };
  const id = useMemo(() => `tf-${Math.random().toString(36).slice(2, 8)}`, []);
  return html`<label class=${cx('field', `field--${size}`, disabled && 'is-disabled', invalid && 'is-invalid', cls)} for=${id}>
    ${label || micro ? html`<span class="field__label">${label}${micro ? html`<span class="micro">${micro}</span>` : null}</span>` : null}
    <span class="field__box brackets">
      ${icon ? html`<${Icon} name=${icon} class="field__icon" />` : null}
      <input id=${id} ref=${ref} class="field__input" name=${name} value=${value} placeholder=${placeholder}
        maxLength=${maxLength} disabled=${disabled} autocomplete="off" spellcheck=${false}
        onInput=${handle}
        oncompositionstart=${() => { composing.current = true; }}
        oncompositionend=${(e) => { composing.current = false; handle(e); }}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing && !composing.current) onEnter?.(e); }} />
    </span>
    ${hint ? html`<span class="field__hint">${hint}</span>` : null}
  </label>`;
}

/** Global overlay hosts for imperative dialogs and tooltips. Mount once near the root. */
export function UiHosts() {
  return html`<${Fragment}><${DialogHost} /><${TooltipLayer} /><//>`;
}
