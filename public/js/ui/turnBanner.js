// 「请选择策略」 — the band the event's strategy draft plays when the pick becomes the player's (video 6:46 and 7:18), drawn
// with the official sprites: the screen dims, a light-grey band slides in from the left carrying the STRONGHOLD PROTOCOL
// mark (settle/common_logo), the contour map (battleReady/bg_terrain) and the ship's outline (battleReady/rhodes_outline),
// a teal fill wipes over it with 请选择策略 and the ring (battleReady/bg_ring), and the band folds shut (≈ 1.7 s). The
// teal square at its right end carries the round plate's robot head (roundStartDialog/round_emoji_head) — [ASSUMED] the
// footage's face there (a winking cube) has no sprite of its own in the extraction.
// screens/bandDraft.js shows it with the 轮到你 sound (co-op only), once the art is in (ui/protocolBoot.js
// bootArtReady); never with prefers-reduced-motion — the draft's header says whose turn it is. Styles:
// css/screens/protocol-boot.css (.tbanner).
import { useEffect } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { uiUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

/** How long the band stays (its animation's length). */
export const TURN_BANNER_MS = 1700;

/** An official sprite: an image, or (`mask`) a box its shape is painted through in the CSS colour. */
function Art({ k, class: cls, mask = false }) {
  const src = uiUrl(data.get('assets'), k);
  if (!src) return null;
  return mask
    ? html`<i class=${cls} style=${`--src:url("${src}")`}></i>`
    : html`<img class=${cls} src=${src} alt="" draggable="false" />`;
}

/**
 * The 「请选择策略」 band; calls onDone when it has played.
 * @param {{ onDone?: Function }} props
 */
export function TurnBanner({ onDone }) {
  useEffect(() => {
    const id = setTimeout(() => onDone?.(), TURN_BANNER_MS);
    return () => clearTimeout(id);
  }, []);
  const cross = (pos) => html`<i class=${`tbanner__cross tbanner__cross--${pos}`}></i>`;
  return html`<div class="tbanner" role="status" aria-live="polite" data-testid="turn-banner">
    <div class="tbanner__dim"></div>
    <div class="tbanner__band">
      <div class="tbanner__bar">
        <div class="tbanner__grey" aria-hidden="true">
          <${Art} k="battleReady/bg_terrain" class="tbanner__topo" mask=${true} />
          <${Art} k="battleReady/rhodes_outline" class="tbanner__ship" mask=${true} />
          <${Art} k="settle/common_logo" class="tbanner__logo" mask=${true} />
          ${cross('tl')}${cross('bl')}${cross('tr')}${cross('br')}
        </div>
        <div class="tbanner__teal">
          <${Art} k="battleReady/bg_terrain" class="tbanner__topo" mask=${true} />
          <${Art} k="battleReady/bg_ring" class="tbanner__ring" mask=${true} />
          <span class="tbanner__text">${t('请选择策略')}</span>
          <span class="tbanner__sub" aria-hidden="true">STRONGHOLD PROTOCOL</span>
          ${cross('tl')}${cross('bl')}${cross('tr')}${cross('br')}
        </div>
      </div>
      <span class="tbanner__bot" aria-hidden="true"><${Art} k="roundStartDialog/round_emoji_head" class="tbanner__head" /></span>
    </div>
  </div>`;
}
