// Compat shim (stronghold-ui-hub package) — install ONLY when the target has no public/js/ui/matchmaking.js.
// The original shows how many doctors are queueing (a presence count the server pushes). Without those counts the
// count is unknown, and an unknown count is not shown at all.
import { html } from './components.js';

/** "N 人匹配中" when `count` is known, else nothing. @param {{ count?: number }} props */
export function MatchmakingCount({ count }) {
  if (!Number.isSafeInteger(count) || count < 0) return null;
  return html`<span class="matchmaking-count"><span class="num">${count}</span>人匹配中</span>`;
}
