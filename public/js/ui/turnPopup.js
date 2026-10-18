// 「轮到你选」 — the disc the event's shared 机变 draft drops over the cards when the pick comes round to the player (video
// 10:07.7–10:08.9), drawn with the official effectChoose/* sprites: the dark disc (bg_circle) inside two teal rings, the
// winking cube (square_1) with its spark (square_2), 轮到你选 under it on the STRONGHOLD PROTOCOL bar (bottom) and the four
// crosses (plus). It pops in (≈ 0.2 s), holds and fades (≈ 1.2 s in all); pointer-events none — the cards stay usable.
// screens/game.js shows it with the 轮到你 sound (a shared draft only), once the sprites are in (turnPopupArtReady);
// never with prefers-reduced-motion — the draft's header says 当前轮到你决策. Styles: css/screens/game-panels.css
// (.sptp). [ASSUMED] the sizes and the timing, measured frame by frame from that footage; the rings are plain CSS circles.
import { useEffect } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { uiUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

/** How long the disc stays (its animation's length). */
export const TURN_POPUP_MS = 1200;

const ART = ['effectChoose/bg_circle', 'effectChoose/square_1', 'effectChoose/square_2', 'effectChoose/plus', 'effectChoose/bottom'];

/** Whether every sprite has loaded (preloadTurnPopupArt): null = not fetched yet, false = missing or still loading. */
let turnArt = null;

/** True once the sprites are all in: without them (no art pack) there is no disc, only the 0.3.0 sound and header. */
export const turnPopupArtReady = () => turnArt === true;

/** Fetch the sprites when the match screen opens (screens/game.js, once per page). A missing pack never turns ready. */
export function preloadTurnPopupArt() {
  if (turnArt !== null || typeof Image !== 'function') return;
  turnArt = false;
  const assets = data.get('assets');
  const urls = ART.map((k) => uiUrl(assets, k));
  if (!urls.every(Boolean)) return;
  let left = urls.length;
  for (const src of urls) {
    const img = new Image();
    img.onload = () => { left -= 1; if (left === 0) turnArt = true; };
    img.onerror = () => { left = -1; };
    img.src = src;
  }
}

function Art({ k, class: cls }) {
  const src = uiUrl(data.get('assets'), k);
  return src ? html`<img class=${cls} src=${src} alt="" draggable="false" />` : null;
}

/**
 * The 「轮到你选」 disc; calls onDone when it has played.
 * @param {{ onDone?: Function }} props
 */
export function TurnPopup({ onDone }) {
  useEffect(() => {
    const id = setTimeout(() => onDone?.(), TURN_POPUP_MS);
    return () => clearTimeout(id);
  }, []);
  const cross = (pos) => html`<${Art} k="effectChoose/plus" class=${`sptp__x sptp__x--${pos}`} />`;
  return html`<div class="sptp" role="status" aria-live="assertive" data-testid="turn-popup">
    <div class="sptp__disc" aria-hidden="true">
      <${Art} k="effectChoose/bg_circle" class="sptp__bg" />
      <i class="sptp__ring"></i>
    </div>
    ${cross('tl')}${cross('tr')}${cross('bl')}${cross('br')}
    <${Art} k="effectChoose/square_2" class="sptp__spark" />
    <${Art} k="effectChoose/square_1" class="sptp__cube" />
    <b class="sptp__text">${t('轮到你选')}</b>
    <${Art} k="effectChoose/bottom" class="sptp__bar" />
  </div>`;
}
