// 选择模拟协议's left picture (2026-10-13, the owner's request: the event's second screen after 独立模拟): an original
// isometric wireframe — a stepped fortress hull on a survey grid, two squares of defenders beside it, enemy spikes
// closing in and a callout — drawn in the selected difficulty's colour (`currentColor`, set by the caller through
// --d-color). The harder the difficulty, the more defenders and spikes. Pure SVG, no picture.
import { html } from './components.js';

const S = 15;            // one unit in px of the 1000 × 640 view box
const OX = 230, OY = 400; // where the origin lands
/** X runs up-right, Y down-right, Z up. */
const iso = (x, y, z = 0) => [OX + (x + y) * 0.866 * S, OY + (y - x) * 0.5 * S - z * S];
const pt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const poly = (pts) => pts.map((p) => pt(iso(...p))).join(' ');

/** The three faces of a box seen from this angle: top, front (y = y1), side (x = x0). */
function box([x0, y0, z0], [x1, y1, z1], key) {
  return html`<g key=${key} class="ps-box">
    <polygon class="ps-face ps-face--side" points=${poly([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]])} />
    <polygon class="ps-face ps-face--front" points=${poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]])} />
    <polygon class="ps-face ps-face--top" points=${poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])} />
  </g>`;
}

const HULL = [
  [[0, 0, 0], [32, 9, 2.4]],          // keel
  [[2.5, 1, 2.4], [29, 8, 4.2]],      // main deck
  [[5, 2, 4.2], [12, 7, 5.6]],        // aft block
  [[15, 1.5, 4.2], [26, 7.5, 6.2]],   // superstructure
  [[18, 2.5, 6.2], [24, 6.5, 8]],     // bridge
  [[21.5, 3.6, 8], [23, 5, 13.5]],    // mast
  [[3, 6.2, 4.2], [4.6, 7.8, 10.5]],  // stack
  [[27, 2, 4.2], [30.5, 7, 4.9]],     // bow plate
];
/** Deck lines (panel seams) for texture. */
const SEAMS = [
  [[3, 2.5, 4.2], [28.5, 2.5, 4.2]], [[3, 5.5, 4.2], [14.5, 5.5, 4.2]], [[8, 1, 4.2], [8, 2, 4.2]],
  [[15.5, 4.5, 6.2], [25.5, 4.5, 6.2]], [[1, 9, 1.2], [31, 9, 1.2]],
];
/** The two squares beside the hull. */
const PADS = [
  { from: [3, -13], to: [19, -3.5] },
  { from: [12, 12], to: [30, 20.5] },
];
const COUNT = { FUNNY: 10, NORMAL: 18, HARD: 26, ABYSS: 34 };
const SPIKES = { FUNNY: 1, NORMAL: 3, HARD: 5, ABYSS: 7 };

/** Defender positions: rows on the two squares, filled alternately up to `n`. */
function defenders(n) {
  const spots = [];
  for (const [i, pad] of PADS.entries()) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      spots.push({ pad: i, x: pad.from[0] + 1.6 + c * ((pad.to[0] - pad.from[0] - 3.2) / 5), y: pad.from[1] + 1.4 + r * ((pad.to[1] - pad.from[1] - 2.8) / 3), k: r * 6 + c });
    }
  }
  // alternate the pads, front rows first, so a low count still fills both
  const order = spots.sort((a, b) => (a.k - b.k) || (a.pad - b.pad)).slice(0, n);
  return order.sort((a, b) => iso(a.x, a.y)[1] - iso(b.x, b.y)[1]);
}

function Figure({ x, y, i }) {
  const [px, py] = iso(x, y, 0);
  return html`<g class="ps-fig" style=${`--i:${i}`}>
    <ellipse class="ps-fig__shadow" cx=${px} cy=${py} rx="9.5" ry="4.2" />
    <path class="ps-fig__body" d=${`M${px - 8} ${py} L${px + 8} ${py} L${px + 7} ${py - 19} Q${px} ${py - 23} ${px - 7} ${py - 19} Z`} />
    <rect class="ps-fig__head" x=${px - 6} y=${py - 34} width="12" height="12" rx="2" />
  </g>`;
}

/** An enemy spike: a thin wedge from outside the squares towards the hull. */
function Spike({ from, to, i }) {
  const a = iso(...from), b = iso(...to);
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * 7, ny = dx / len * 7;
  return html`<g class="ps-spike" style=${`--i:${i}`}>
    <polygon points=${`${a[0] + nx},${a[1] + ny} ${b[0]},${b[1]} ${a[0] - nx},${a[1] - ny}`} />
    <path d=${`M${a[0] - 8} ${a[1] - 8}l16 16M${a[0] + 8} ${a[1] - 8}l-16 16`} class="ps-spike__x" />
  </g>`;
}
const SPIKE_PATHS = [
  [[-6, 4.5], [0, 4.5]], [[36, 3], [32, 4]], [[10, 25], [12, 11]], [[22, -16], [19, -1]],
  [[-4, 16], [4, 10]], [[34, 15], [29, 10]], [[0, -10], [3, -1]],
];

/**
 * @param {{ difficulty: string }} props FUNNY | NORMAL | HARD | ABYSS
 */
export function ProtocolScene({ difficulty }) {
  const n = COUNT[difficulty] ?? COUNT.FUNNY;
  const spikes = SPIKE_PATHS.slice(0, SPIKES[difficulty] ?? 1);
  const grid = [];
  for (let x = -8; x <= 40; x += 4) grid.push(html`<line key=${`x${x}`} x1=${iso(x, -18)[0]} y1=${iso(x, -18)[1]} x2=${iso(x, 26)[0]} y2=${iso(x, 26)[1]} />`);
  for (let y = -18; y <= 26; y += 4) grid.push(html`<line key=${`y${y}`} x1=${iso(-8, y)[0]} y1=${iso(-8, y)[1]} x2=${iso(40, y)[0]} y2=${iso(40, y)[1]} />`);
  const mastTop = iso(22.2, 4.3, 13.5);
  const callAt = iso(8, -6, 15);
  return html`<svg class="ps" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <g class="ps-grid">${grid}</g>
    <path class="ps-cable" d=${`M${mastTop[0] + 60} -10 C${mastTop[0] + 70} 120 ${mastTop[0] - 20} 110 ${mastTop[0]} ${mastTop[1]}`} />
    ${PADS.map((p, i) => html`<g key=${`pad${i}`} class="ps-pad">
      <polygon points=${poly([[p.from[0], p.from[1], 0], [p.to[0], p.from[1], 0], [p.to[0], p.to[1], 0], [p.from[0], p.to[1], 0]])} />
      <polyline class="ps-pad__edge" points=${poly([[p.from[0] - 1.5, p.from[1] - 1.5, 0], [p.to[0] + 1.5, p.from[1] - 1.5, 0], [p.to[0] + 1.5, p.to[1] + 1.5, 0]])} />
    </g>`)}
    <g class="ps-figs ps-figs--back">${defenders(n).filter((f) => f.pad === 0).map((f, i) => html`<${Figure} key=${`a${f.k}`} x=${f.x} y=${f.y} i=${i} />`)}</g>
    <g class="ps-hull">
      ${HULL.map(([a, b], i) => box(a, b, i))}
      ${SEAMS.map(([a, b], i) => html`<line key=${`s${i}`} class="ps-seam" x1=${iso(...a)[0]} y1=${iso(...a)[1]} x2=${iso(...b)[0]} y2=${iso(...b)[1]} />`)}
      <circle class="ps-beacon" cx=${mastTop[0]} cy=${mastTop[1]} r="3.5" />
    </g>
    <g class="ps-figs">${defenders(n).filter((f) => f.pad === 1).map((f, i) => html`<${Figure} key=${`b${f.k}`} x=${f.x} y=${f.y} i=${i} />`)}</g>
    <g class="ps-spikes">${spikes.map(([a, b], i) => html`<${Spike} key=${i} from=${[a[0], a[1], 0]} to=${[b[0], b[1], 0.5]} i=${i} />`)}</g>
    <g class="ps-call">
      <line x1=${iso(10, 1, 6.2)[0]} y1=${iso(10, 1, 6.2)[1]} x2=${callAt[0] + 40} y2=${callAt[1] + 70} />
      <rect x=${callAt[0]} y=${callAt[1]} width="96" height="70" />
      <rect class="ps-call__icon" x=${callAt[0] + 8} y=${callAt[1] + 8} width="24" height="54" />
      <path class="ps-call__man" d=${`M${callAt[0] + 20} ${callAt[1] + 18}a4 4 0 1 1 0 .1M${callAt[0] + 14} ${callAt[1] + 26}h12v14h-3v14h-6v-14h-3z`} />
      <line x1=${callAt[0] + 40} y1=${callAt[1] + 16} x2=${callAt[0] + 86} y2=${callAt[1] + 16} />
      <line x1=${callAt[0] + 40} y1=${callAt[1] + 28} x2=${callAt[0] + 76} y2=${callAt[1] + 28} />
      <line x1=${callAt[0] + 40} y1=${callAt[1] + 40} x2=${callAt[0] + 82} y2=${callAt[1] + 40} />
      <text x=${callAt[0] + 40} y=${callAt[1] + 60}>DEF ${String(n).padStart(2, '0')}</text>
    </g>
    <line class="ps-scan" x1="0" y1="0" x2="1000" y2="0" />
  </svg>`;
}
