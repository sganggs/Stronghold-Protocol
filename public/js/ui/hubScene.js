// 大厅场景 (PR #643 split 8): four generated scenes in place of the official entry backdrop — 夜巡, 霜原, 烬野, 静默 —
// every line original (no game art): ridges by midpoint displacement from fixed seeds, so every visit draws the same
// skyline, a stronghold silhouette on the middle ridge, beacons, lit windows, a searchlight, drifting motes / snow.
// The colours are tokens per scene (css/screens/lobby.css [data-hub-theme]); reduced motion stops every animation.
// The choice is the lobby.media pref `scene` (ui/lobbyMedia.js); 'official' keeps the event's backdrop.
import { html } from './components.js';
import { N_ } from '../../../shared/i18n.js';

/** The scenes of the 大厅背景与音乐 dialog: the official backdrop first, then the generated ones. */
export const HUB_SCENES = [
  { id: 'official', name: N_('默认背景'), en: 'OFFICIAL' },
  { id: 'night', name: N_('夜巡'), en: 'NIGHT WATCH' },
  { id: 'frost', name: N_('霜原'), en: 'FROSTLINE' },
  { id: 'ember', name: N_('烬野'), en: 'EMBERFIELD' },
  { id: 'calm', name: N_('静默'), en: 'SILENT' },
];
export const SCENE_IDS = HUB_SCENES.map((x) => x.id);

// ---- the generated skyline (viewBox 1600×600, ground at the bottom) -------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
/** A ridge profile by midpoint displacement: 65 points across the width. */
function ridgePoints(seed, base, amp, rough) {
  const rnd = rng(seed);
  let pts = [base + (rnd() - 0.5) * amp, base + (rnd() - 0.5) * amp];
  let disp = amp;
  while (pts.length < 65) { // loop-cap: doubles from 2 to 65 points in 6 passes
    const next = [];
    for (let i = 0; i < pts.length - 1; i++) next.push(pts[i], (pts[i] + pts[i + 1]) / 2 + (rnd() - 0.5) * disp);
    next.push(pts[pts.length - 1]);
    pts = next;
    disp *= rough;
  }
  return pts;
}
const DX = 1600 / 64;
const yAt = (pts, x) => {
  const i = Math.min(63, Math.max(0, Math.floor(x / DX)));
  const f = x / DX - i;
  return pts[i] * (1 - f) + pts[i + 1] * f;
};
const edge = (pts) => pts.map((y, i) => `${i ? 'L' : 'M'}${(i * DX).toFixed(1)} ${y.toFixed(1)}`).join('');
const area = (pts) => `${edge(pts)}V600H0Z`;

// the far range opens into a valley behind the title, its peaks frame the emblem from both sides
const FAR = ridgePoints(0x51a7, 286, 150, 0.56).map((y, i) => y + 70 * Math.exp(-(((i * DX - 800) / 340) ** 2)));
// the stronghold stands on a levelled shelf of the middle ridge (x 540–1060)
const MID = ridgePoints(0x7e11, 440, 90, 0.55).map((y, i) => {
  const x = i * DX;
  const w = x < 480 || x > 1120 ? 0 : x < 560 ? (x - 480) / 80 : x > 1040 ? (1120 - x) / 80 : 1;
  return y * (1 - w) + 424 * w;
});
const NEAR = ridgePoints(0x2b3c, 512, 46, 0.5);

/** A crenellated block: base → up the left side → merlons along the top → down the right side. */
function block(x0, x1, top, base, h, w, gap) {
  let d = `M${x0} ${base}V${top}`;
  for (let x = x0 + 3; x + w <= x1 - 3; x += w + gap) d += `H${x}V${top - h}H${x + w}V${top}`;
  return `${d}H${x1}V${base}Z`;
}
const FORT = [
  block(540, 1060, 400, 440, 5, 7, 6), // curtain wall
  block(580, 616, 358, 440, 6, 6, 5),
  'M660 440V394L690 381L720 394V440Z', // depot
  block(760, 822, 324, 440, 7, 8, 6), // keep
  block(777, 805, 302, 330, 5, 5, 4),
  'M790 302V266h2v36zM785 278h12v1.6h-12z', // mast
  block(930, 962, 350, 440, 6, 6, 5),
  'M945 350V318h1.6v32z',
  block(1020, 1046, 368, 440, 5, 5, 4),
].join('');
const MASTS = [260, 1330].map((x) => {
  const y = yAt(FAR, x);
  return `M${x} ${y.toFixed(1)}V${(y - 46).toFixed(1)}h1.4V${y.toFixed(1)}zM${x - 5} ${(y - 30).toFixed(1)}h11.4v1.2h-11.4z`;
}).join('');
const MAST_TOPS = [260, 1330].map((x) => [x + 0.7, yAt(FAR, x) - 47]);
const BEACONS = [[791, 265, 2.4, 0], [945.8, 317, 2, 1.3], [598, 351, 1.6, 2.1], ...MAST_TOPS.map(([x, y], i) => [x, y, 1.6, 0.7 + i * 1.7])];
const WINDOWS = [[771, 338], [808, 350], [786, 372], [594, 380], [944, 372], [1031, 386], [700, 410], [870, 412]];

const MOTES = (() => {
  const rnd = rng(0x5eed);
  return Array.from({ length: 26 }, () => ({
    x: rnd() * 100, y: 28 + rnd() * 66, s: 1 + rnd() * 2.2, d: 14 + rnd() * 16, dl: rnd() * 30,
  }));
})();
const STARS = (() => {
  const rnd = rng(0x57a2);
  return Array.from({ length: 46 }, () => {
    const a = 0.25 + rnd() * 0.55;
    return `${(rnd() * 100).toFixed(2)}vw ${(rnd() * 44).toFixed(2)}vh 0 ${rnd() < 0.15 ? '.6px' : '0'} rgba(220, 240, 235, ${a.toFixed(2)})`;
  }).join(',');
})();

/** A generated scene (`theme`: night / frost / ember / calm), drawn inside the lobby's .hub-bg. */
export function HubScene({ theme }) {
  if (!SCENE_IDS.includes(theme) || theme === 'official') return null;
  return html`<div class="hub-scene" data-hub-theme=${theme} data-testid="hub-scene">
    <div class="hub-bg__sky"></div>
    ${theme === 'night' || theme === 'frost' ? html`<i class="hub-bg__stars" style=${`box-shadow:${STARS}`}></i>` : null}
    <div class="hub-bg__haze"></div>
    ${theme !== 'calm' ? html`<div class="hub-bg__clouds"></div>` : null}
    <svg class="hub-bg__land" viewBox="0 0 1600 600" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="hubFog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="hub-fog-0" /><stop offset=".55" class="hub-fog-1" /><stop offset="1" class="hub-fog-0" />
        </linearGradient>
        <linearGradient id="hubBeam" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" class="hub-beam-0" /><stop offset="1" class="hub-beam-1" />
        </linearGradient>
      </defs>
      <path class="hub-bg__ridge hub-bg__ridge--far" d=${area(FAR)} />
      <path class="hub-bg__rim" d=${edge(FAR)} />
      <path class="hub-bg__ridge--far" d=${MASTS} />
      <rect x="0" y="290" width="1600" height="170" fill="url(#hubFog)" />
      ${theme === 'night' || theme === 'frost' ? html`<path class="hub-bg__beam" d="M791 300L700 -300H776Z" fill="url(#hubBeam)" />` : null}
      <path class="hub-bg__fort" d=${FORT} />
      <g class="hub-bg__windows">${WINDOWS.map(([x, y], i) => html`<rect key=${i} x=${x} y=${y} width="3" height="5" style=${`--dl:${(i * 1.9) % 7}s`} />`)}</g>
      <g class="hub-bg__beacons">${BEACONS.map(([x, y, r, dl], i) => html`<g key=${i} style=${`--dl:${dl}s`}>
        <circle class="hub-bg__beacon-glow" cx=${x} cy=${y} r=${r * 4} /><circle cx=${x} cy=${y} r=${r} /></g>`)}</g>
      <path class="hub-bg__ridge hub-bg__ridge--mid" d=${area(MID)} />
      <rect x="0" y="430" width="1600" height="120" fill="url(#hubFog)" opacity=".7" />
      <path class="hub-bg__ridge hub-bg__ridge--near" d=${area(NEAR)} />
    </svg>
    ${theme !== 'calm' ? html`<div class="hub-bg__motes">${MOTES.map((m, i) => html`<i key=${i} class="hub-bg__mote"
      style=${`left:${m.x.toFixed(2)}%;top:${m.y.toFixed(2)}%;width:${m.s.toFixed(1)}px;height:${m.s.toFixed(1)}px;--d:${m.d.toFixed(1)}s;--dl:-${m.dl.toFixed(1)}s`}></i>`)}</div>` : null}
  </div>`;
}

/** A small preview of a scene for the dialog's swatches (the official one: a dark field with the hologram's glow). */
export function SceneSwatch({ theme }) {
  return html`<span class="bgset__swatch" data-hub-theme=${theme} aria-hidden="true">
    <svg viewBox="0 0 160 90" preserveAspectRatio="none">
      <path class="sw-far" d="M0 56L18 49L34 53L56 38L76 47L98 36L122 49L142 42L160 51V90H0Z" />
      <path class="sw-mid" d="M0 68L28 62L50 66H56V60H60V55H66V48H70V55H76V60H100V66L124 62L160 68V90H0Z" />
      <path class="sw-near" d="M0 80L40 74L90 79L130 73L160 78V90H0Z" />
      <circle class="sw-beacon" cx="68" cy="46" r="1.3" />
    </svg>
  </span>`;
}
