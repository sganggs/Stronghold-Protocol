// 「协议启动！」 over BATTLE_CHECK (screens/game.js), as the event's pre-game shows it (video 7:43–7:51), drawn with the
// official battleReady/* sprites and settle/common_logo:
//   from black the Rhodes Island ship (battleReady/rhodes, turned ≈ 53°) fills the screen in bright teal and zooms out
//   into the middle; then the contour map (bg_terrain), the two mountains (bg_mountain1 / 2) and the ring (bg_ring) come
//   up behind it, the doctors' cards (01 COMPLETE ✓ + their avatar) open on both sides with lines into the ship, and
//   协议启动！ / STRONGHOLD PROTOCOL / 正在连接… stand under it. A solo run has one card under the ring.
// One 1920×1080 stage in `--u` (1 design px = 0.01 --u, fitted to the viewport). Without the art pack the 0.3.0 banner
// stays (screens/game.js asks bootArtReady); with prefers-reduced-motion the screen shows at once, without the motion.
// Styles: css/screens/protocol-boot.css.
import { html, Icon } from './components.js';
import { PlayerAvatar } from './gameComponents.js';
import { uiUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** How long the screen takes to fade once BATTLE_CHECK is over (screens/game.js keeps it mounted meanwhile). */
export const BOOT_LEAVE_MS = 350;

// the pre-game's sprites: this screen's, and the 请选择策略 band's (ui/turnBanner.js) — fetched and judged together
const ART = ['battleReady/rhodes', 'battleReady/bg_terrain', 'battleReady/bg_mountain1', 'battleReady/bg_mountain2', 'battleReady/bg_ring',
  'settle/common_logo', 'battleReady/rhodes_outline', 'roundStartDialog/round_emoji_head'];

/** Whether every sprite has loaded (preloadBootArt): null = not fetched yet, false = missing or still loading. */
let bootArt = null;

/**
 * True once the pre-game sprites are all in: screens/game.js shows the 0.3.0 banner until then, screens/bandDraft.js no
 * 请选择策略 band.
 */
export const bootArtReady = () => bootArt === true;

/**
 * Fetch the sprites when the match screen opens (screens/game.js, once per page; the band draft before BATTLE_CHECK
 * leaves them time). A missing pack never turns ready.
 */
export function preloadBootArt() {
  if (bootArt !== null || typeof Image !== 'function') return;
  bootArt = false;
  const assets = data.get('assets');
  const urls = ART.map((k) => uiUrl(assets, k));
  if (!urls.every(Boolean)) return;
  let left = urls.length;
  for (const src of urls) {
    const img = new Image();
    img.onload = () => { left -= 1; if (left === 0) bootArt = true; };
    img.onerror = () => { left = -1; };
    img.src = src;
  }
}

/**
 * Where the doctors' cards sit on the 1920×1080 stage (design px, measured from the footage): 01 / 03 on the left,
 * 02 / 04 on the right, each with its line from the card's inner edge to a node on the ship; a solo run's one card
 * under the ring. [ASSUMED] the footage shows four doctors only: five or six take a third row (all moved up half a
 * row), and the solo card's place is estimated.
 * @param {number} n players
 * @returns {Array<{ x: number, y: number, side: 'l'|'r'|'c', from?: [number, number], to?: [number, number] }>}
 */
export function bootLayout(n) {
  if (n <= 1) return [{ x: 703, y: 645, side: 'c' }];
  const NODES = [[939, 497], [1008, 513], [905, 548], [968, 575], [930, 610], [1000, 630]];
  return Array.from({ length: Math.min(n, 6) }, (_, i) => {
    const right = i % 2 === 1;
    const row = Math.floor(i / 2);
    const y = 414 + row * 166 - (n > 4 ? 83 : 0);
    const x = right ? 1233 : 172;
    return { x, y, side: right ? 'r' : 'l', from: [right ? x - 10 : x + 525, y + 63], to: NODES[i] };
  });
}

/** An official sprite as a positioned image (no lazy loading: the screen lasts 3 s). */
function Art({ k, class: cls, mask = false }) {
  const src = uiUrl(data.get('assets'), k);
  if (!src) return null;
  return mask
    ? html`<i class=${cls} style=${`--src:url("${src}")`}></i>`
    : html`<img class=${cls} src=${src} alt="" draggable="false" />`;
}

/**
 * 「协议启动！」. `leaving` fades it out.
 * @param {{ players: any[], myId: any, leaving?: boolean }} props
 */
export function ProtocolBoot({ players, myId, leaving = false }) {
  const list = (Array.isArray(players) ? players : []).slice(0, 6);
  const spots = bootLayout(list.length);
  return html`<div class=${cx('pboot', list.length <= 1 && 'pboot--solo', leaving && 'is-leaving')} role="status" aria-live="polite" aria-label=${t('协议启动！')}
      data-testid="protocol-boot">
    <div class="pboot__stage">
      <div class="pboot__scene" aria-hidden="true">
        <${Art} k="battleReady/bg_mountain1" class="pboot__mtn pboot__mtn--1" />
        <${Art} k="battleReady/bg_mountain2" class="pboot__mtn pboot__mtn--2" />
        <${Art} k="battleReady/bg_terrain" class="pboot__terrain" mask=${true} />
        <${Art} k="battleReady/bg_ring" class="pboot__ring" />
        <${Art} k="settle/common_logo" class="pboot__logo" mask=${true} />
        ${[[117, 393], [117, 732], [1800, 393], [1800, 732]].map(([x, y]) => html`<i key=${`${x}-${y}`} class="pboot__cross"
          style=${`--x:${x};--y:${y}`}></i>`)}
      </div>
      <div class="pboot__ship" aria-hidden="true"><${Art} k="battleReady/rhodes" class="pboot__shipimg" /></div>
      <svg class="pboot__lines" viewBox="0 0 1920 1080" aria-hidden="true">
        ${spots.filter((s) => s.from).map((s, i) => html`<g key=${i} style=${`--i:${i}`}>
          <line x1=${s.from[0]} y1=${s.from[1]} x2=${s.to[0]} y2=${s.to[1]} pathLength="1" />
          <rect x=${s.to[0] - 9} y=${s.to[1] - 9} width="18" height="18" class="pboot__node" />
          <rect x=${s.from[0] - 11} y=${s.from[1] - 11} width="22" height="22" class="pboot__anchor" />
        </g>`)}
      </svg>
      ${list.map((p, i) => {
        const s = spots[i];
        return html`<div key=${p.playerId ?? i} class=${cx('pboot__card', `pboot__card--${s.side}`, p.playerId === myId && 'is-self')}
            style=${`--x:${s.x};--y:${s.y};--i:${i}`}>
          <span class="pboot__txt">
            <b class="pboot__num num">${String(i + 1).padStart(2, '0')}</b>
            <span class="pboot__done">COMPLETE</span>
            <i class="pboot__check"><${Icon} name="check" /></i>
          </span>
          <span class="pboot__face"><${PlayerAvatar} player=${p} self=${p.playerId === myId} /></span>
        </div>`;
      })}
      <h2 class="pboot__title">${t('协议启动！')}</h2>
      <span class="pboot__sub">STRONGHOLD PROTOCOL</span>
      <span class="pboot__conn">${t('正在连接')}<i class="pboot__dots"></i></span>
    </div>
    <div class="pboot__veil" aria-hidden="true"></div>
  </div>`;
}
