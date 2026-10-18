// Host test-dock geometry (DESIGN §34.8). Pure: no DOM. The numbers are the HUD's own boxes, also written as
// unitless rem custom properties on `.gm, .testconsole` in css/screens/game.css (keep the two in step).
//
// Default home, in rem, then × the layout root (css/theme.css: clamp(40px, min(100vw/19.2, 100svh/10.8), 240px)):
//   x = teamRight + margin
//       teamRight = .team left .22 + avatar .8 + gap .1 + name max-width 1.5 + info padding .06+.12
//   y = max(bondBottom, topBar) + margin
//       bondBottom = fieldHost.js HUD_REM.bondStripBottom (2.16)
//       topBar = the bottom of .gtop (1.02)
//   bottom = viewport height − handClear − margin
//       handClear = prep hudPadding bottom 3.2 + the bench piece height 1.56
//   width = min(3.6rem, 28vw)
// That rectangle sits on the field: right of a 4-player .team, below the bond strip and the top bar, above the
// full hand. The shop bar (HUD_REM.shopBarTop) and the funds card sit in the bottom band under the hand, so they
// stay clear as well. The ready button is the top-right column (.gtop padding + clock + .readybtn).
// A viewport at most 720 CSS px wide keeps the phone top sheet and ignores a stored position.

export const DOCK_POS_KEY = 'sp.testConsolePos';

/** Unitless rem. Mirrors css/screens/game.css `.gm, .testconsole` --dock-* and the HUD rules named above. */
export const DOCK_REM = Object.freeze({
  width: 3.6,
  margin: 0.08,
  teamLeft: 0.22,
  teamRight: 2.8,
  teamTop: 2.36,
  teamAvatar: 0.8,
  teamGap: 0.14,
  teamRows: 4,
  bondLeft: 1.56,
  bondTop: 1.36,
  bondBottom: 2.16,
  bondSlot: 0.74,
  bondGap: 0.1,
  topBar: 1.02,
  handClear: 4.76,
  handLeft: 2.85,
  readyRight: 0.3,
  readyWidth: 2.6,
  readyHeight: 1.56,
  shopTop: 2.64,
  fundsWidth: 1.18,
  shopRight: 0.26,
});

/** Layout root in CSS px. Same clamp as css/theme.css. */
export function remOf(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return 40;
  return Math.min(240, Math.max(40, Math.min(w / 19.2, h / 10.8)));
}

/**
 * Read the HUD's --dock-* properties. A missing property keeps `fallback` (DOCK_REM).
 * `style` is a CSSStyleDeclaration or `{ getPropertyValue }`.
 * @param {{ getPropertyValue?: (name: string) => string }|null|undefined} style
 * @param {typeof DOCK_REM} [fallback]
 */
export function dockMetricsFromStyle(style, fallback = DOCK_REM) {
  const num = (name, fb) => {
    let raw = '';
    try { raw = style?.getPropertyValue?.(name) ?? ''; } catch { /* a thrown getter keeps the fallback */ }
    const n = parseFloat(String(raw));
    return Number.isFinite(n) ? n : fb;
  };
  return {
    width: num('--dock-w', fallback.width),
    margin: num('--dock-margin', fallback.margin),
    teamLeft: num('--dock-team-left', fallback.teamLeft),
    teamRight: num('--dock-team-right', fallback.teamRight),
    teamTop: num('--dock-team-top', fallback.teamTop),
    teamAvatar: num('--dock-team-avatar', fallback.teamAvatar),
    teamGap: num('--dock-team-gap', fallback.teamGap),
    teamRows: num('--dock-team-rows', fallback.teamRows),
    bondLeft: num('--dock-bond-left', fallback.bondLeft),
    bondTop: num('--dock-bond-top', fallback.bondTop),
    bondBottom: num('--dock-bond-bottom', fallback.bondBottom),
    bondSlot: num('--dock-bond-slot', fallback.bondSlot),
    bondGap: num('--dock-bond-gap', fallback.bondGap),
    topBar: num('--dock-top', fallback.topBar),
    handClear: num('--dock-hand-clear', fallback.handClear),
    handLeft: num('--dock-hand-left', fallback.handLeft),
    readyRight: num('--dock-ready-right', fallback.readyRight),
    readyWidth: num('--dock-ready-w', fallback.readyWidth),
    readyHeight: num('--dock-ready-h', fallback.readyHeight),
    shopTop: num('--dock-shop-top', fallback.shopTop),
    fundsWidth: num('--dock-funds-w', fallback.fundsWidth),
    shopRight: num('--dock-shop-right', fallback.shopRight),
  };
}

/**
 * Default dock box. `{ sheet: true }` at width ≤ 720. Otherwise a field panel in CSS px.
 * @param {{ width: number, height: number }} size
 * @param {typeof DOCK_REM} [metrics]
 */
export function dockHome(size, metrics = DOCK_REM) {
  const w = Number(size?.width) || 0;
  const h = Number(size?.height) || 0;
  if (!(w > 0) || !(h > 0) || w <= 720) return { sheet: true };
  const rem = remOf(w, h);
  const px = (r) => r * rem;
  const width = Math.min(px(metrics.width), w * 0.28);
  const x = px(metrics.teamRight + metrics.margin);
  const y = px(Math.max(metrics.bondBottom, metrics.topBar) + metrics.margin);
  const bottom = h - px(metrics.handClear + metrics.margin);
  const height = Math.max(0, bottom - y);
  return { sheet: false, x, y, width, height, rem };
}

/** HUD boxes the open dock must miss, in CSS px, from the same rem metrics. */
export function dockObstacles(size, metrics = DOCK_REM) {
  const w = Number(size?.width) || 0;
  const h = Number(size?.height) || 0;
  const rem = remOf(w, h);
  const px = (r) => r * rem;
  const teamH = metrics.teamRows * metrics.teamAvatar + Math.max(0, metrics.teamRows - 1) * metrics.teamGap;
  const handTop = h - px(metrics.handClear);
  return {
    topBar: { x: 0, y: 0, w, h: px(metrics.topBar) },
    team: { x: px(metrics.teamLeft), y: px(metrics.teamTop), w: px(metrics.teamRight - metrics.teamLeft), h: px(teamH) },
    bonds: {
      x: px(metrics.bondLeft), y: px(metrics.bondTop),
      w: px(metrics.bondSlot * 2 + metrics.bondGap), h: px(metrics.bondBottom - metrics.bondTop),
    },
    hand: { x: px(metrics.handLeft), y: handTop, w: Math.max(0, w - px(metrics.handLeft)), h: h - handTop },
    ready: {
      x: w - px(metrics.readyRight + metrics.readyWidth), y: px(0.2),
      w: px(metrics.readyWidth), h: px(metrics.readyHeight - 0.2),
    },
    shop: { x: 0, y: h - px(metrics.shopTop), w, h: px(metrics.shopTop) },
    funds: {
      x: w - px(metrics.shopRight + metrics.fundsWidth), y: h - px(metrics.shopTop),
      w: px(metrics.fundsWidth), h: px(metrics.shopTop),
    },
  };
}

/** Overlap area in px². Touching edges are 0. */
export function rectAreaOverlap(a, b) {
  if (!a || !b) return 0;
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (!(x > 0) || !(y > 0)) return 0;
  return x * y;
}

/** Keep the panel inside the viewport. A panel larger than the viewport pins to the origin. */
export function clampDock(pos, viewport, panel) {
  const w = Number(viewport?.width) || 0;
  const h = Number(viewport?.height) || 0;
  const pw = Math.min(Math.max(0, Number(panel?.width) || 0), w);
  const ph = Math.min(Math.max(0, Number(panel?.height) || 0), h);
  const x = Number(pos?.x);
  const y = Number(pos?.y);
  return {
    x: Math.min(Math.max(0, Number.isFinite(x) ? x : 0), Math.max(0, w - pw)),
    y: Math.min(Math.max(0, Number.isFinite(y) ? y : 0), Math.max(0, h - ph)),
  };
}

/** `{x,y}` from storage, or null. A thrown getItem (private mode) is null. */
export function readDockPos(storage) {
  try {
    const raw = storage?.getItem?.(DOCK_POS_KEY);
    if (typeof raw !== 'string' || !raw) return null;
    const p = JSON.parse(raw);
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

/** Remember `{x,y}`. False when storage throws or the point is not finite. */
export function writeDockPos(pos, storage) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const x = Number(pos?.x);
    const y = Number(pos?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    storage.setItem(DOCK_POS_KEY, JSON.stringify({ x, y }));
    return true;
  } catch {
    return false;
  }
}
