// Pre-game motion (2026-10-13, the owner's request: the event's pre-game, video 6:29–7:51), original drawings only:
//   * TurnBanner — 「请选择策略」: the screen dims, a light-grey band with the STRONGHOLD PROTOCOL mark slides in from the
//     left, a mint fill wipes over it carrying the words, and the band folds shut (≈1.65 s). The strategy draft shows it
//     whenever a pick becomes the player's (screens/bandDraft.js).
//   * ProtocolBoot — 「协议启动！」 over BATTLE_CHECK (screens/game.js): from black a circuit-board fortress builds up
//     large, shrinks into the centre, a flash, then the doctors' cards (01 COMPLETE ✓ …) open out to both sides with lines
//     to the core, 协议启动！ and 正在连接… under them. One stage of 16:9 (container units) so lines meet their cards on
//     every screen. Styles: css/screens/draft.css (tbanner / pboot).
// With prefers-reduced-motion the banner is skipped and the boot screen shows its last frame.
import { useEffect, useMemo } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { PlayerAvatar } from './gameComponents.js';
import { reducedMotion } from './device.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** How long the 「请选择策略」 band stays (its animation's length). */
export const TURN_BANNER_MS = 1650;

/** The STRONGHOLD PROTOCOL mark: a rook in brackets over two lines of type (an original drawing). */
export function ProtocolMark({ class: cls }) {
  return html`<span class=${cx('pmark', cls)} aria-hidden="true">
    <svg class="pmark__glyph" viewBox="0 0 32 32"><path d="M3 4h4v2H5v20h2v2H3zM29 4h-4v2h2v20h-2v2h4z" />
      <path d="M10 8h3v2h2V8h2v2h2V8h3v5l-2 2v6l2 2v2H10v-2l2-2v-6l-2-2z" /></svg>
    <span class="pmark__type">STRONGHOLD<br />PROTOCOL</span>
  </span>`;
}

/**
 * 「请选择策略」 sweep; calls onDone when it has played (at once with reduced motion, which never draws it).
 * @param {{ text: any, onDone?: Function }} props
 */
export function TurnBanner({ text, onDone }) {
  const quiet = reducedMotion();
  useEffect(() => {
    const id = setTimeout(() => onDone?.(), quiet ? 0 : TURN_BANNER_MS);
    return () => clearTimeout(id);
  }, []);
  if (quiet) return null;
  return html`<div class="tbanner" role="status" aria-live="polite">
    <div class="tbanner__dim"></div>
    <div class="tbanner__band">
      <div class="tbanner__bar">
        <div class="tbanner__grey"><${ProtocolMark} class="tbanner__logo" /><i class="tbanner__map"></i></div>
        <div class="tbanner__mint"><i class="tbanner__map"></i><span class="tbanner__text">${text}</span><i class="tbanner__ring"></i></div>
      </div>
      <span class="tbanner__bot"><${Icon} name="robot" /></span>
    </div>
  </div>`;
}

/** A small seeded generator (the board looks the same every time). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** The circuit-board fortress of the boot screen: blocks of a 640×320 board (x, y, w, h, opacity, build-up delay). */
export function bootBoard(seed = 319) {
  const r = rng(seed);
  const out = [
    { x: 30, y: 52, w: 580, h: 216, o: 0.34, d: 0 },   // the board
    { x: 214, y: 92, w: 212, h: 136, o: 0.62, d: 60 },  // the keep
    { x: 290, y: 92, w: 60, h: 136, o: 0.3, d: 120 },   // its cross
    { x: 214, y: 140, w: 212, h: 40, o: 0.3, d: 120 },
  ];
  for (let i = 0; i < 46; i++) {
    const w = 12 + Math.round(r() * 70);
    const h = 10 + Math.round(r() * 46);
    out.push({ x: 40 + Math.round(r() * (560 - w)), y: 60 + Math.round(r() * (200 - h)), w, h,
      o: +(0.3 + r() * 0.65).toFixed(2), d: Math.round(r() * 300) });
  }
  for (let i = 0; i < 14; i++) { // pins along both long edges
    const x = 60 + i * 38;
    out.push({ x, y: 36, w: 18, h: 12, o: 0.55, d: 200 + i * 8 }, { x, y: 272, w: 18, h: 12, o: 0.55, d: 220 + i * 8 });
  }
  return out;
}

/**
 * Where the doctors' cards sit on the 1600×900 stage: two columns (01 left, 02 right, 03 left …) around the core, or one
 * card centred for a solo run. Each: the card box, the side, and its line from the card's inner edge to a core node.
 * @param {number} n
 * @returns {Array<{ left: number, top: number, w: number, h: number, side: 'l'|'r'|'c', from: [number, number], to: [number, number] }>}
 */
export function bootLayout(n) {
  const W = 428, H = 107;
  if (n <= 1) return [{ left: 586, top: 452, w: W, h: H, side: 'c', from: [800, 452], to: [800, 452] }];
  const rows = Math.ceil(n / 2);
  const step = Math.min(138, 360 / rows); // the rows stay between the header art and 协议启动！
  const h = Math.min(H, step * 0.78);
  const top0 = 468 - ((rows - 1) * step) / 2 - h / 2;
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / 2);
    const right = i % 2 === 1;
    const top = top0 + row * step;
    const mid = top + h / 2;
    const left = right ? 1027 : 1600 - 1027 - W;
    const nodeY = 435 + (row - (rows - 1) / 2) * 44 + (right ? 16 : 0);
    const nodeX = right ? 838 - row * 18 : 782 - row * 24;
    return { left, top, w: W, h, side: right ? 'r' : 'l', from: [right ? left - 6 : left + W + 6, mid], to: [nodeX, nodeY] };
  });
}

const pct = (v, of) => `${(v / of) * 100}%`;

/**
 * 「协议启动！」 (BATTLE_CHECK). `leaving` fades it out (screens/game.js keeps it mounted meanwhile: ui/transitions.js usePresence).
 * @param {{ players: any[], myId: any, leaving?: boolean }} props
 */
export function ProtocolBoot({ players, myId, leaving = false }) {
  const board = useMemo(() => bootBoard(), []);
  const list = Array.isArray(players) ? players : [];
  const spots = bootLayout(list.length);
  return html`<div class=${cx('pboot', leaving && 'is-leaving')} role="status" aria-live="polite" aria-label=${t('协议启动！')}>
    <div class="pboot__stage">
      <svg class="pboot__bg" viewBox="0 0 1600 900" aria-hidden="true">
        <circle cx="800" cy="430" r="330" class="pboot__orbit" />
        <circle cx="800" cy="430" r="250" class="pboot__orbit pboot__orbit--in" />
        ${[0, 1, 2, 3, 4, 5].map((i) => html`<path key=${i} class="pboot__topo"
          d=${`M${-40 + i * 30} ${180 + i * 95} C ${300 + i * 20} ${90 + i * 90}, ${620 - i * 30} ${330 + i * 70}, ${900 + i * 15} ${210 + i * 95} S ${1380} ${120 + i * 110}, ${1660} ${260 + i * 90}`} />`)}
        ${[[95, 325], [1500, 325], [95, 605], [1500, 605]].map(([x, y]) => html`<path key=${`${x}-${y}`} class="pboot__cross" d=${`M${x - 26} ${y}h52M${x} ${y - 26}v52`} />`)}
      </svg>
      <div class="pboot__chip" aria-hidden="true">
        <svg viewBox="0 0 640 320">
          ${board.map((b, i) => html`<rect key=${i} x=${b.x} y=${b.y} width=${b.w} height=${b.h} style=${`--o:${b.o};--d:${b.d}ms`} />`)}
          <circle cx="566" cy="96" r="20" class="pboot__port" /><circle cx="566" cy="96" r="11" class="pboot__port" />
        </svg>
      </div>
      <div class="pboot__flash" aria-hidden="true"></div>
      <${ProtocolMark} class="pboot__mark" />
      <svg class="pboot__lines" viewBox="0 0 1600 900" aria-hidden="true">
        ${spots.filter((s) => s.side !== 'c').map((s, i) => html`<g key=${i} style=${`--i:${i}`}>
          <line x1=${s.from[0]} y1=${s.from[1]} x2=${s.to[0]} y2=${s.to[1]} pathLength="1" />
          <rect x=${s.to[0] - 8} y=${s.to[1] - 8} width="16" height="16" class="pboot__node" />
          <rect x=${s.from[0] - 10} y=${s.from[1] - 10} width="20" height="20" class="pboot__anchor" />
        </g>`)}
      </svg>
      ${list.map((p, i) => {
        const s = spots[i];
        return html`<div key=${p.playerId} class=${cx('pcardx', `pcardx--${s.side}`, p.playerId === myId && 'is-self')}
            style=${`left:${pct(s.left, 1600)};top:${pct(s.top, 900)};width:${pct(s.w, 1600)};height:${pct(s.h, 900)};--i:${i}`}>
          <span class="pcardx__mark"><svg viewBox="0 0 32 32"><path d="M3 4h4v2H5v20h2v2H3zM29 4h-4v2h2v20h-2v2h4z" /><path d="M10 8h3v2h2V8h2v2h2V8h3v5l-2 2v6l2 2v2H10v-2l2-2v-6l-2-2z" /></svg></span>
          <span class="pcardx__txt"><b class="num">${String(i + 1).padStart(2, '0')}</b><span>COMPLETE</span><i><${Icon} name="check" /></i></span>
          <span class="pcardx__face"><${PlayerAvatar} player=${p} self=${p.playerId === myId} /></span>
        </div>`;
      })}
      <h2 class="pboot__title">${t('协议启动！')}</h2>
      <span class="pboot__sub">STRONGHOLD PROTOCOL</span>
      <span class="pboot__conn">${t('正在连接')}<i class="pboot__dots"></i></span>
    </div>
    <div class="pboot__veil" aria-hidden="true"></div>
  </div>`;
}
