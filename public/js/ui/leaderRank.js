// The leader-fight ranking (the right-edge list under 隐藏), every version (§37.149; 规程 only from §37.124). A pure
// function of m.public: spectators and a replay that restores public frames see the same rows. The percentage is this
// operator's damage over the pool's max HP: the official rows only grow within a fight (solo recording BV12ZWP6pE7m)
// and sum well under 100, a share of the damage dealt so far could shrink.
// The viewer’s 隐藏 choice is local (this browser), not part of the match.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { UnitThumb } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';
import { loadPref, savePref } from '../store.js';

const PREF = 'leaderRankHidden';

/**
 * Integer percent of the pool. 0 when the pool or the damage is not a positive finite number.
 * A positive hit that would round to 0% is shown as 1%. [ASSUMED] display rounding.
 * @param {number} dmg
 * @param {number} maxHp
 */
export function leaderSharePct(dmg, maxHp) {
  const max = Number(maxHp);
  const n = Number(dmg);
  if (!(max > 0) || !Number.isFinite(max) || !Number.isFinite(n) || !(n > 0)) return 0;
  const pct = Math.round((n / max) * 100);
  return pct > 0 ? pct : 1;
}

/** @returns {boolean} true when this viewer last hid the list. A missing or throwing store reads as shown. */
export function loadLeaderRankHidden() {
  return loadPref(PREF, false) === true;
}

/** @param {boolean} hidden */
export function saveLeaderRankHidden(hidden) {
  savePref(PREF, hidden === true);
}

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Box */

/**
 * Where the list goes when its home (under the top bar's right end) would cover the right column — the countdown and,
 * once the level time runs out, the red 「生命值 −1/秒」 warning under it (ui/hud.js OvertimeWarning). Only a tall
 * countdown reaches that far: 可露希尔's TV put the list over the TV and over the warning (the owner, 2026-11-14
 * 「boss关扣生命值的提示会被伤害排行窗口遮挡」, §37.201). Then the list stays at the right edge, under the column, its right
 * edge clear of the DP box beside it. Moved left of the column (§37.201) it sat in the middle of the field under the
 * 规程 themes' wide top-bar column (the owner, 2026-11-14 「伤害排行窗口太靠中间了，有点遮挡场上」, §37.207); left of the
 * column, under the bond strip, stays the fallback when there is no room under it above `floor`.
 * Pure; boxes in viewport px, the result in px from the HUD's top / right edge, null = stay home.
 * @param {{ panel: Box|null, column: Box|null, hud: Box|null, bonds?: Box|null, dp?: Box|null, floor?: number|null, gap?: number }} o
 * @returns {{ top: number, right: number }|null}
 */
export function leaderRankSpot({ panel, column, hud, bonds = null, dp = null, floor = null, gap = 6 }) {
  if (!panel || !column || !hud) return null;
  const crosses = panel.left < column.right && panel.right > column.left && panel.top < column.bottom && panel.bottom > column.top;
  if (!crosses) return null;
  const height = panel.bottom - panel.top;
  const below = column.bottom + gap;
  if (below + height <= (floor ?? hud.bottom)) {
    let right = hud.right - panel.right;
    if (dp && dp.left < panel.right && dp.right > panel.left && dp.top < below + height && dp.bottom > below) right = Math.max(right, hud.right - dp.left + gap);
    return { top: Math.round(below - hud.top), right: Math.round(right) };
  }
  const top = Math.max(panel.top, bonds && bonds.bottom > 0 ? bonds.bottom + gap : panel.top) - hud.top;
  return { top: Math.round(top), right: Math.round(hud.right - column.left + gap) };
}

/**
 * The list's spot, measured while it shows and again whenever the right column changes size (the warning comes, a theme
 * swaps the countdown) or the window resizes. null = home (the CSS spot).
 * @param {boolean} active
 * @returns {{ top: number, right: number }|null}
 */
export function useLeaderRankSpot(active) {
  const [spot, setSpot] = useState(/** @type {{ top: number, right: number }|null} */ (null));
  useEffect(() => {
    if (!active) { setSpot(null); return undefined; }
    /** @param {Element|null} el @returns {Box|null} */
    const box = (el) => { const b = el?.getBoundingClientRect(); return b && b.width > 0 ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null; };
    let frame = null;
    const measure = () => {
      frame = null;
      const panel = /** @type {HTMLElement|null} */ (document.querySelector('.ldmg'));
      // read the home spot: drop the override for the reading, then put it back
      const keep = panel ? [panel.style.top, panel.style.right] : null;
      if (panel) { panel.style.top = ''; panel.style.right = ''; }
      // the column with what sticks out of it (the warning may be wider than a narrow column)
      const col = document.querySelector('.gtop__right');
      const parts = col ? [col, ...col.children].map(box).filter(Boolean) : [];
      const column = parts.length ? parts.reduce((u, b) => ({ left: Math.min(u.left, b.left), top: Math.min(u.top, b.top),
        right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom) })) : null;
      const hud = box(document.querySelector('.gm__hud'));
      // room under the column down to the bottom bar's band (1.4rem: the camera switch and the corner buttons)
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const next = leaderRankSpot({ panel: box(panel), column, hud, bonds: box(document.querySelector('.gm__bonds')),
        dp: box(document.querySelector('.dpbox')), floor: hud ? hud.bottom - 1.4 * rem : null });
      if (panel && keep) { panel.style.top = keep[0]; panel.style.right = keep[1]; }
      setSpot((old) => (old?.top === next?.top && old?.right === next?.right ? old : next));
    };
    const later = () => { if (frame == null) frame = requestAnimationFrame(measure); };
    const column = document.querySelector('.gtop__right');
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
    if (column && ro) ro.observe(column);
    addEventListener('resize', later);
    later();
    return () => { ro?.disconnect(); removeEventListener('resize', later); if (frame != null) cancelAnimationFrame(frame); };
  }, [active]);
  return spot;
}

/**
 * Hook-free. `rows` is m.public.leaderTop, `players` is m.public.players, `maxHp` is bossHp.max; `spot` (useLeaderRankSpot)
 * moves the list off a tall right column. Hidden: only the show button remains.
 * @param {{ rows: any[]|null|undefined, players: any[]|null|undefined, maxHp: number, hidden: boolean, onToggle: () => void, spot?: { top: number, right: number }|null }} props
 */
export function LeaderRank({ rows, players, maxHp, hidden, onToggle, spot = null }) {
  const list = Array.isArray(rows) ? rows.slice(0, 3) : [];
  const names = new Map();
  if (Array.isArray(players)) {
    for (const p of players) if (p && p.playerId) names.set(p.playerId, typeof p.name === 'string' && p.name ? p.name : p.playerId);
  }
  return html`<aside class=${spot ? 'ldmg is-moved' : 'ldmg'} aria-label=${t('领袖伤害排行')}
      style=${spot ? `top:${spot.top}px;right:${spot.right}px` : null}>
    <button type="button" class="ldmg__toggle" onClick=${onToggle}>${hidden ? t('显示') : t('隐藏')}</button>
    ${hidden ? null : html`<ol class="ldmg__list">
      ${list.map((row) => html`<li key=${`${row.pid}:${row.uid}`} class="ldmg__row">
        <${UnitThumb} kind="chess" id=${row.chess} tier=${row.tier} size="xs" ownerId=${row.pid} />
        <span class="ldmg__name">${names.get(row.pid) || row.pid}</span>
        <span class="ldmg__share" title=${t('对领袖伤害占比')}><${Icon} name="sword" />${`${leaderSharePct(row.dmg, maxHp)}%`}</span>
      </li>`)}
    </ol>`}
  </aside>`;
}
