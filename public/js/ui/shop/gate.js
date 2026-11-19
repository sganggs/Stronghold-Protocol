// Stage B theme gate: when the WebGL shop may replace the DOM shop bar.
//
// The gate is the product's own capability test, not a theme id, version or rollout flag:
//   the installed official group carries prefabs.json + card.json + shop.json
//   → the runtime preloaded; the rewardOffer stays in the same shop.
// A theme without the WebGL shop documents simply keeps the DOM bar; selecting ac_s_closur is the release
// (rollback = switch theme). Reasons are diagnostic (logged / surfaced in metrics), never shown to the player.

import { officialThemeById } from '../../../../shared/uiTheme.js';
import { data as gameData } from '../../data.js';

/**
 * Whether the installed official group carries every document the WebGL shop renders (the extractor
 * registers prefabs.json, card.json and shop.json in data/local-assets.json).
 * @param {Record<string, any>|null|undefined} groups data.get('local').groups
 * @param {string|null|undefined} themeId settings.uiTheme
 * @returns {{ ok: boolean, group: string|null, missing: string[] }}
 */
export function shopCapability(groups, themeId) {
  const group = officialThemeById(themeId)?.group || null;
  if (!group) return { ok: false, group: null, missing: ['theme'] };
  const entries = groups && groups[group];
  if (!entries) return { ok: false, group, missing: ['group'] };
  const missing = ['prefabs.json', 'card.json', 'shop.json'].filter((file) => !entries[file]);
  return { ok: missing.length === 0, group, missing };
}

/**
 * @param {{ themeId?: string|null, groups?: Record<string, any>|null,
 *   runtime?: 'idle'|'loading'|'ready'|'failed' }} input
 *   `groups` overrides data.get('local').groups (tests/dev); `runtime` is preloadShopRuntime's status.
 *   The call site still passes `priv` and `spectator`; neither is an input: a spectator seat has no m.private, so
 *   game.js shows no shop at all, and stand-ins / DIY are resolved by the card model (adapter/model.js).
 * @returns {{ on: boolean, reason: string|null }}
 */
export function shopWebglGate(input = {}) {
  const groups = input.groups !== undefined ? input.groups : (gameData.get('local') || {}).groups;
  const capability = shopCapability(groups, input.themeId);
  if (!capability.group) return { on: false, reason: 'theme' };
  if (capability.missing.includes('group')) return { on: false, reason: 'pack' };
  if (!capability.ok) return { on: false, reason: 'capability' };

  const runtime = input.runtime || 'idle';
  if (runtime !== 'ready') return { on: false, reason: runtime === 'failed' ? 'failed' : 'loading' };

  // 观战: a spectator seat has no m.private, so game.js never shows a shop at all (old bar nor canvas). The shop gate
  // therefore has nothing to exclude here; a watched teammate's shop would be a new read-only view, not this gate.
  // 补位 (m.private.standIns) and 自选编队 (m.private.diy) are normal play: the card model resolves their composed
  // records (adapter/model.js ownStandIn / ownDiyRecord). The official card carries no extra badge for either.

  return { on: true, reason: null };
}
