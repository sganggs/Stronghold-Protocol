// 「协议已失效」 — the dialog the event shows when the player's own LP runs out while the team plays on (video 10:56–
// 10:58): over the official map (settle/settlemen_personal_fail) the robot's face is knocked out (X eyes), 协议已失效 /
// STRONGHOLD PROTOCOL beside it, and two buttons under it. The face has no sprite in the extracted art, so it is an
// original pixel drawing (PIX below), as the maintainer's checklist allows where no official art exists.
// The official second button is 前往结算 (the player's own settlement at once); this project settles a match only when
// it ends, so the button here is the existing 离开模拟 dialog (ui/matchChrome.js ExitModal) [ASSUMED]. 继续观战 (or Esc)
// closes it and the player watches on, as in 0.3.0. It is the project's Modal (focus trap, focus returned).
// screens/game.js opens it once, when the player's `alive` turns false with a teammate still in, and only once the map
// sprite is in (downedArtReady): without the art pack 0.3.0's toast and pill stay. With prefers-reduced-motion it shows
// without the motion. Styles: css/screens/game-panels.css (.downm). [ASSUMED] the positions, sizes and timing, measured
// from that footage.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from './components.js';
import { GIcon } from './gameComponents.js';
import { uiUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const MAP = 'settle/settlemen_personal_fail';

/** Whether the map sprite has loaded (preloadDownedArt): null = not fetched yet, false = missing or still loading. */
let mapArt = null;

/** True once the map sprite is in: without it screens/game.js keeps 0.3.0's toast and pill only. */
export const downedArtReady = () => mapArt === true;

/** Fetch the sprite when the match screen opens (screens/game.js, once per page). A missing pack never turns ready. */
export function preloadDownedArt() {
  if (mapArt !== null || typeof Image !== 'function') return;
  mapArt = false;
  const src = uiUrl(data.get('assets'), MAP);
  if (!src) return;
  const img = new Image();
  img.onload = () => { mapArt = true; };
  img.src = src;
}

/**
 * Whether the dialog is due: the player's own `alive` just turned false (not a spectator seat, not a reload that finds
 * the player out already) and a teammate is still in — when the whole team falls the match ends instead.
 * @param {{ was: boolean|undefined, alive: boolean, spectator: boolean, pub: any, myId: string|null }} o
 */
export function downedDue({ was, alive, spectator, pub, myId }) {
  if (spectator || was !== true || alive !== false) return false;
  const players = Array.isArray(pub?.players) ? pub.players : [];
  return players.some((p) => p && p.playerId !== myId && p.alive !== false);
}

/** The robot's face, calm and knocked out: '#' = a pixel. Original drawings (no official sprite). */
export const PIX = Object.freeze({
  calm: [
    '......##......',
    '......##......',
    '.############.',
    '.#..........#.',
    '.#..........#.',
    '.#..##..##..#.',
    '.#..........#.',
    '.#..........#.',
    '.#..........#.',
    '.#...####...#.',
    '.#..........#.',
    '.############.',
    '...##....##...',
  ],
  downed: [
    '......##......',
    '......##......',
    '.############.',
    '.#..........#.',
    '.#.#.#..#.#.#.',
    '.#..#....#..#.',
    '.#.#.#..#.#.#.',
    '.#..........#.',
    '.#....##....#.',
    '.#...#..#...#.',
    '.#....##....#.',
    '.############.',
    '...##....##...',
  ],
});

/** One path of 1-high rectangles: every row's runs of '#'. */
export function pixPath(rows) {
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (row[x] !== '#') { x++; continue; }
      let w = 1;
      while (row[x + w] === '#') w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w;
    }
  });
  return d;
}

/** The face as crisp inline SVG (sized by CSS, coloured by `color`). */
function PixFace({ kind, class: cls }) {
  const rows = PIX[kind];
  return html`<svg class=${cls} viewBox=${`0 0 ${rows[0].length} ${rows.length}`} shape-rendering="crispEdges" aria-hidden="true">
    <path d=${pixPath(rows)} fill="currentColor" />
  </svg>`;
}

/**
 * The 协议已失效 dialog.
 * @param {{ open: boolean, onWatch: Function, onLeave: Function }} props
 */
export function DownedPlate({ open, onWatch, onLeave }) {
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (!open) { setOut(false); return undefined; }
    const id = setTimeout(() => setOut(true), 500);
    return () => clearTimeout(id);
  }, [open]);
  const map = uiUrl(data.get('assets'), MAP);
  return html`<${Modal} open=${open} onClose=${onWatch} closeOnBackdrop=${false} class="downm" veilClass="downm-veil" tone="red">
    <div class="downm__panel" data-testid="downed-plate">
      ${map ? html`<img class="downm__map" src=${map} alt="" draggable="false" />` : null}
      <i class="downm__x downm__x--tl"></i><i class="downm__x downm__x--tr"></i><i class="downm__x downm__x--bl"></i><i class="downm__x downm__x--br"></i>
      <span class=${`downm__face${out ? ' is-out' : ''}`}><${PixFace} kind=${out ? 'downed' : 'calm'} class="downm__pix" /></span>
      <h2 class="downm__title">${t('协议已失效')}</h2>
      <span class="downm__sub" aria-hidden="true">STRONGHOLD PROTOCOL</span>
    </div>
    <div class="downm__btns">
      <${Button} variant="secondary" class="downm__btn downm__btn--watch" data-autofocus=${true} onClick=${onWatch}><${GIcon} name="eye" class="btn__icon" />${t('继续观战')}<//>
      <${Button} variant="danger" icon="exit" class="downm__btn downm__btn--leave" onClick=${onLeave}>${t('离开模拟')}<//>
    </div>
  <//>`;
}
