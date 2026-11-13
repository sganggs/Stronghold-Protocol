// The leader-fight ranking (the right-edge list under 隐藏), every version (§37.149; 规程 only from §37.124). A pure
// function of m.public: spectators and a replay that restores public frames see the same rows. The percentage is this
// operator's damage over the pool's max HP: the official rows only grow within a fight (solo recording BV12ZWP6pE7m)
// and sum well under 100, a share of the damage dealt so far could shrink.
// The viewer’s 隐藏 choice is local (this browser), not part of the match.

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

/**
 * Hook-free. `rows` is m.public.leaderTop, `players` is m.public.players, `maxHp` is bossHp.max.
 * Hidden: only the show button remains.
 * @param {{ rows: any[]|null|undefined, players: any[]|null|undefined, maxHp: number, hidden: boolean, onToggle: () => void }} props
 */
export function LeaderRank({ rows, players, maxHp, hidden, onToggle }) {
  const list = Array.isArray(rows) ? rows.slice(0, 3) : [];
  const names = new Map();
  if (Array.isArray(players)) {
    for (const p of players) if (p && p.playerId) names.set(p.playerId, typeof p.name === 'string' && p.name ? p.name : p.playerId);
  }
  return html`<aside class="ldmg" aria-label=${t('领袖伤害排行')}>
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
