// 成就奖杯等级 (the owner, 2026-10-14, the PRTS 同盟成就奖杯 table): the account's cumulative trophies pick one of five
// chess-piece badges — 0~9 / 10~29 / 30~59 / 60~99 / 100+ (data/config.json trophies.medals, the official medalDataList),
// art data/assets.json ui['medalIcon/trophy_level<n>_icon']; the SVG rook while the pack is missing or fails to load.
// Mine come from my account's records (ui/achievements.js achievementStats); anybody else's from /accounts/lookup
// (`trophies`, the sidecar's sum of that account's records).

import { useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
export const MEDAL_STEPS = [0, 10, 30, 60, 100];

/** The trophy level (1..5) of a cumulative count. */
export function trophyLevel(count, medals = data.get('config')?.trophies?.medals) {
  const steps = Array.isArray(medals) && medals.length ? medals.map((m) => Number(m?.count) || 0) : MEDAL_STEPS;
  const n = Number.isFinite(count) ? count : 0;
  let lv = 1;
  steps.forEach((min, i) => { if (n >= min) lv = i + 1; });
  return lv;
}

/**
 * The trophy-level badge.
 * @param {{ count: number|null|undefined, class?: string, title?: string }} props  count null: unknown (a guest) → nothing
 */
export function TrophyBadge({ count, class: cls, title }) {
  useData('assets'); useData('config');
  const [bad, setBad] = useState(null);
  if (!Number.isFinite(count)) return null;
  const lv = trophyLevel(count);
  const ui = data.get('assets')?.ui;
  const src = ui && typeof ui === 'object' ? ui[`medalIcon/trophy_level${lv}_icon`] : null;
  const tip = title ?? t('奖杯等级 {lv} · 累计奖杯 {n}', { lv, n: count });
  if (typeof src === 'string' && src && bad !== src) {
    return html`<img class=${cx('tbadge', `tbadge--${lv}`, cls)} src=${src} alt=${tip} title=${tip} draggable=${false} onError=${() => setBad(src)} />`;
  }
  return html`<span class=${cx('tbadge', 'tbadge--svg', `tbadge--${lv}`, cls)} title=${tip}><${Icon} name="rook" /></span>`;
}
