// 完美连胜 / 领袖伤害 on a team-panel avatar (DESIGN §37.148), every version. The server publishes both on m.public
// players[] (server/match/match/views.js _avatarView): winStreak / winStreakLevel — the rounds in a row settled without
// an LP loss, shown from 3 (规程 constData playerAvatarWinStreakThresholds [3, 5]: level 1 from 3, level 2 from 5) and
// counted on at every settlement (4, 5, 6 … a leader fight neither adds nor breaks it) — and bossDamageLevel — while a
// leader fight runs, the player's share of the leader pool (playerAvatarBossDamageThresholds 20 / 50 / 80 % → 1–3),
// live: m.public follows a boss fight at ~1 Hz, the level appears the moment the share crosses its step and is gone in
// the prep after the fight.
// Drawn from the official player-avatar prefabs (playeravatar/panel_win_streak, playeravatar/panel_boss_damage): the
// chosen 规程 theme's own (可露希尔 has its own look), else ac_n_initial's, the look of every other version and theme
// (乌萨斯齐心团's pack has none: the client borrows the default's). Each prefab's controller lists its rank layers
// (`_rankItems`); the shown one is made active, the streak count goes into that rank's `_streakText`, and the rank's
// PlayAutomatically clip loops (the leader-damage scan sweeps the avatar from top to bottom every 6 s).
// Placement from the co-op recording BV13LWM6BEvY (part 1 ≈ 8:00 and 41:30, part 4 ≈ 48:38): the streak badge sits on
// the avatar's top-right corner, a little inside it [ASSUMED: the holder's position, measured, not read from the client];
// both badges are drawn at the prefab's own scale on the 80-unit avatar — the scan layers over the avatar's own box,
// their 80-unit rects on it (the flare, twice as wide, crosses both edges as in the recording).
// Without the local art: a CSS stand-in — a gold triangle (level 1) or a dark star (level 2) with the count, an amber
// band sweeping the avatar (corner marks at level 3).

import { html } from './components.js';
import { PrefabView, indexIds } from './prefab/view.js';
import { t } from '../../../shared/i18n.js';

export const WIN_STREAK_PREFAB = 'playeravatar/panel_win_streak';
export const BOSS_DAMAGE_PREFAB = 'playeravatar/panel_boss_damage';
/** The team panel's avatar (.pavatar, 0.8rem) in prefab units (1 unit = 0.01rem): the leader-damage layers' box. */
export const AVATAR_UNITS = 80;
/**
 * The streak holder: one rank layer's own box (33.76 units), at the prefab's own scale on the 80-unit avatar (the
 * recording: the triangle ≈ 28 %, the star ≈ 49 % of the avatar's width; this draws them at 30 % and 44 %).
 */
export const STREAK_BOX = 33.76;
export const STREAK_SCALE = 1;
/** The leader-damage steps of the badge's tooltip (the server's gd.bossDamageThresholds default). */
const DAMAGE_STEPS = [20, 50, 80];

const cx = (...p) => p.filter(Boolean).join(' ');

/** True when the pack carries both avatar prefabs. @param {any} pack */
export function hasAvatarBadges(pack) {
  const pf = pack?.doc?.prefabs;
  return !!(pf && pf[WIN_STREAK_PREFAB] && pf[BOSS_DAMAGE_PREFAB]);
}

/**
 * The pack that draws the badges: the theme's own (`themePack`, the 规程 HUD pack), else the default pack
 * (ac_n_initial), else null (the CSS stand-in). @param {any} themePack @param {any} basePack
 */
export function avatarBadgePack(themePack, basePack) {
  if (hasAvatarBadges(themePack)) return themePack;
  return hasAvatarBadges(basePack) ? basePack : null;
}

/**
 * A badge prefab's controller refs: its rank layers in order (`_rankItems`) and each rank's count text (`_streakText`,
 * null when the rank has none). @param {any} prefab @returns {{ ranks: number[], texts: (number|null)[] }}
 */
export function rankRefs(prefab) {
  const ranks = [];
  for (const s of prefab?.scripts || []) {
    const list = s?.refs?._rankItems;
    if (Array.isArray(list)) { for (const id of list) if (Number.isInteger(id)) ranks.push(id); break; }
  }
  const ids = indexIds(prefab);
  const texts = ranks.map((id) => {
    for (const s of ids.get(id)?.scripts || []) if (Number.isInteger(s?.refs?._streakText)) return s.refs._streakText;
    return null;
  });
  return { ranks, texts };
}

/**
 * The overrides that show rank `level` (1-based; others stay inactive) with `count` in its text. Null when the prefab
 * has no such rank. @param {any} prefab @param {number} level @param {string|null} [count]
 * @returns {{ active: Map<number, boolean>, texts: Map<number, string|null> } | null}
 */
export function rankPose(prefab, level, count = null) {
  const { ranks, texts } = rankRefs(prefab);
  const at = Math.trunc(Number(level)) - 1;
  if (!(at >= 0 && at < ranks.length)) return null;
  const active = new Map(ranks.map((id, i) => [id, i === at]));
  const text = new Map();
  if (texts[at] != null && count != null) text.set(texts[at], count);
  return { active, texts: text };
}

/** rankPose per prefab, level and count, kept so a re-render hands PrefabView the same maps (no relayout). */
const poseCache = new WeakMap();
/** @param {any} prefab @param {number} level @param {string|null} [count] */
function cachedPose(prefab, level, count = null) {
  let byKey = poseCache.get(prefab);
  if (!byKey) { byKey = new Map(); poseCache.set(prefab, byKey); }
  const key = `${level}|${count ?? ''}`;
  if (!byKey.has(key)) byKey.set(key, rankPose(prefab, level, count));
  return byKey.get(key);
}

/** The tooltip lines of a row's badges (none below the first level). @param {any} p m.public players[] entry */
export function avatarBadgeTips(p) {
  const out = [];
  const streak = Math.trunc(Number(p?.winStreak) || 0);
  if (Number(p?.winStreakLevel) > 0 && streak > 0) out.push(t('完美连胜：已连续 {n} 回合没有损失目标生命值', { n: streak }));
  const level = Math.trunc(Number(p?.bossDamageLevel) || 0);
  if (level > 0) out.push(t('领袖伤害：已造成本轮领袖 {pct}% 以上的伤害', { pct: DAMAGE_STEPS[Math.min(level, DAMAGE_STEPS.length) - 1] }));
  return out;
}

/**
 * The streak badge (level 1 / 2) on the avatar's top-right corner.
 * @param {{ pack: any, level: number, streak: number, still?: boolean }} props
 */
export function WinStreakBadge({ pack, level, streak, still = false }) {
  const prefab = pack?.doc?.prefabs?.[WIN_STREAK_PREFAB] || null;
  const count = String(Math.max(0, Math.trunc(Number(streak) || 0)));
  const pose = prefab ? cachedPose(prefab, level, count) : null;
  if (!(level > 0)) return null;
  if (pose) {
    // keyed by the level: the new rank's own loop starts with it (PrefabView restarts loops on status changes only)
    return html`<span class="abadge abadge--streak" aria-hidden="true">
      <${PrefabView} key=${level} pack=${pack} prefab=${prefab} active=${pose.active} texts=${pose.texts}
        size=${[STREAK_BOX, STREAK_BOX]} scale=${STREAK_SCALE} still=${still} className="abadge__pf" />
    </span>`;
  }
  return html`<span class=${cx('abadge', 'abadge--streak', 'is-css', level >= 2 ? 'is-r2' : 'is-r1')} aria-hidden="true">
    <i class="abadge__base"></i><b class="abadge__n num">${count}</b>
  </span>`;
}

/**
 * The leader-damage layers (level 1–3) over the avatar.
 * @param {{ pack: any, level: number, still?: boolean }} props
 */
export function BossDamageBadge({ pack, level, still = false }) {
  const prefab = pack?.doc?.prefabs?.[BOSS_DAMAGE_PREFAB] || null;
  const pose = prefab ? cachedPose(prefab, level) : null;
  if (!(level > 0)) return null;
  if (pose) {
    // data-pack: the CSS's per-pack corrections (ac_n_initial's scan band, screens/game.css)
    return html`<span class="abadge abadge--boss" data-pack=${pack.group || ''} aria-hidden="true">
      <${PrefabView} key=${level} pack=${pack} prefab=${prefab} active=${pose.active}
        size=${[AVATAR_UNITS, AVATAR_UNITS]} still=${still} className="abadge__pf" />
    </span>`;
  }
  return html`<span class=${cx('abadge', 'abadge--boss', 'is-css', `is-l${Math.min(3, Math.trunc(level))}`, still && 'is-still')} aria-hidden="true">
    <i class="abadge__scan"></i>
  </span>`;
}
