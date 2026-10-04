// render/textures.js — procedural textures drawn with Canvas 2D and uploaded once as PIXI textures:
//   * tile material atlas (2048², 256 px cells with 8 px clamp gutters, mipmapped, anisotropic) for the ground mesh
//     and every textured 3D box (blocks, crates, devices). Cells are the real board art of the local client when
//     it is available (render/boardArt.js + tools/crop-board-atlas.mjs → tiles.json: crops of TX_autochessi_D /
//     common_D composed per material), else procedural drawings — the UV layout is identical either way, so the
//     renderer swaps the texture without touching geometry,
//   * FX atlas (one base texture ⇒ particles batch / fit a ParticleContainer),
//   * status icons, tier chips, backdrop gradients,
//   * HUD rings: the element discs of the element gauge row and the redeploy countdown ring (hudRings / ringArc),
//   * avatar-in-rarity-diamond composites (cached per unit asset id) for the Spine fallback.
// Everything procedural is deterministic (seeded noise) and generated lazily on first use. Requires
// globalThis.PIXI and a DOM canvas at call time (never at import time).

import { statusIconKey } from './style.js';

const PIXI = () => globalThis.PIXI;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

// =============================================================================================================
// Tile materials

export const CELL = 256;
export const GUTTER = 8;
const INNER = CELL - GUTTER * 2;
const ATLAS_W = 2048, ATLAS_H = 2048;
/** The procedural drawers were authored for a 112 px cell interior. */
const PROC_UNIT = 112;

/** Ordered material list (atlas cell index = position; 64 cells max). */
export const MATERIALS = [
  'road', 'road2', 'road3', 'roadN', 'roadN2', 'floor', 'floor2', 'preview', 'wall', 'wallSide', 'forbid', 'forbid2', 'forbidSide',
  'sep', 'sepSide', 'fence', 'fenceSide', 'start', 'end', 'telin', 'telout', 'hand', 'temp', 'benchSide', 'benchSideTemp', 'mire',
  'smog', 'deepsea', 'infection', 'cliff', 'blank', 'lowSide', 'margin',
  // high-ground plates by connectivity (horizontal strip L/M/R, vertical strip B(near)/VM/T(far); 'wall' = single)
  'wallL', 'wallM', 'wallR', 'wallB', 'wallVM', 'wallT',
  // textured props
  'crateSide', 'crateTop', 'blowerTop', 'sealed', 'turretTop', 'platformTop',
  // the enemy preview pen: glossy glass panes in a hazard frame (render/pen.js, research 09 §2.1 screenshot)
  'penGlass',
];

/** Art layers of materials the crop table (tiles.json) may not describe yet: the board atlas' glass hatch + a glaze. */
const DEFAULT_ART_LAYERS = Object.freeze({
  penGlass: Object.freeze([Object.freeze({ src: 'D', rect: [549, 1787, 255, 256] }), Object.freeze({ proc: 'glass' })]),
});

function speckle(ctx, x, y, w, h, r, n, colors, size = [0.6, 1.8]) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(r() * colors.length) | 0];
    const s = size[0] + r() * (size[1] - size[0]);
    ctx.fillRect(x + r() * w, y + r() * h, s, s);
  }
}

function bevelTile(ctx, x, y, s, o) {
  const m = o.seam ?? 3;
  ctx.fillStyle = o.seamColor ?? '#2a3033';
  ctx.fillRect(x, y, s, s);
  const g = ctx.createLinearGradient(x, y, x + s, y + s);
  g.addColorStop(0, o.light);
  g.addColorStop(1, o.dark);
  ctx.fillStyle = g;
  ctx.fillRect(x + m, y + m, s - 2 * m, s - 2 * m);
  // bevel
  const bw = o.bevel ?? 2.5;
  ctx.fillStyle = o.hi ?? 'rgba(255,255,255,0.22)';
  ctx.fillRect(x + m, y + m, s - 2 * m, bw);
  ctx.fillRect(x + m, y + m, bw, s - 2 * m);
  ctx.fillStyle = o.lo ?? 'rgba(0,0,0,0.28)';
  ctx.fillRect(x + m, y + s - m - bw, s - 2 * m, bw);
  ctx.fillRect(x + s - m - bw, y + m, bw, s - 2 * m);
}

function cracks(ctx, x, y, s, r, n, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let px = x + 10 + r() * (s - 20), py = y + 10 + r() * (s - 20);
    ctx.beginPath();
    ctx.moveTo(px, py);
    const len = 3 + ((r() * 5) | 0);
    let ang = r() * Math.PI * 2;
    for (let k = 0; k < len; k++) {
      ang += (r() - 0.5) * 1.2;
      px += Math.cos(ang) * (3 + r() * 5); py += Math.sin(ang) * (3 + r() * 5);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function brackets(ctx, x, y, s, inset, len, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'square';
  const a = x + inset, b = y + inset, c = x + s - inset, d = y + s - inset;
  ctx.beginPath();
  ctx.moveTo(a, b + len); ctx.lineTo(a, b); ctx.lineTo(a + len, b);
  ctx.moveTo(c - len, b); ctx.lineTo(c, b); ctx.lineTo(c, b + len);
  ctx.moveTo(c, d - len); ctx.lineTo(c, d); ctx.lineTo(c - len, d);
  ctx.moveTo(a + len, d); ctx.lineTo(a, d); ctx.lineTo(a, d - len);
  ctx.stroke();
}

function hazardBand(ctx, x, y, w, h, stripe = 10, c1 = '#e8b21f', c2 = '#1b1d1f') {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = c2; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = c1;
  for (let k = -h; k < w + h; k += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + stripe, y + h); ctx.lineTo(x + k + stripe + h, y); ctx.lineTo(x + k + h, y);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const MAT_DRAW = {
  road(ctx, x, y, s, r) { roadBase(ctx, x, y, s, r, 1); brackets(ctx, x, y, s, 11, 15, 'rgba(255,255,255,0.42)', 2.4); },
  road2(ctx, x, y, s, r) { roadBase(ctx, x, y, s, r, 2); brackets(ctx, x, y, s, 11, 15, 'rgba(255,255,255,0.42)', 2.4); },
  road3(ctx, x, y, s, r) { roadBase(ctx, x, y, s, r, 3); brackets(ctx, x, y, s, 11, 15, 'rgba(255,255,255,0.42)', 2.4); },
  roadN(ctx, x, y, s, r) { roadBase(ctx, x, y, s, r, 4, true); },
  roadN2(ctx, x, y, s, r) { roadBase(ctx, x, y, s, r, 5, true); },
  floor(ctx, x, y, s, r) { floorBase(ctx, x, y, s, r); },
  floor2(ctx, x, y, s, r) { floorBase(ctx, x, y, s, r); cracks(ctx, x, y, s, r, 2, 'rgba(0,0,0,0.18)'); },
  penGlass(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#6b7377', dark: '#5a6165', seamColor: '#2b3134', hi: 'rgba(255,255,255,0.14)' });
    const f = s * 0.1;
    ctx.save(); hazardBand(ctx, x + f * 0.6, y + f * 0.6, s - f * 1.2, s - f * 1.2, 7, '#e2b53a', '#1d2124'); ctx.restore();
    PROC_LAYERS.glass(ctx, x, y, s, r);
  },
  preview(ctx, x, y, s, r) {
    floorBase(ctx, x, y, s, r);
    ctx.save(); ctx.globalAlpha = 0.18; hazardBand(ctx, x + 6, y + 6, s - 12, s - 12, 9, '#d0453b', 'rgba(0,0,0,0)'); ctx.restore();
  },
  wall(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#b9c1c5', dark: '#99a2a7', seamColor: '#5d676c', hi: 'rgba(255,255,255,0.55)', lo: 'rgba(40,48,52,0.35)', bevel: 3.5 });
    speckle(ctx, x + 4, y + 4, s - 8, s - 8, r, 260, ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.07)']);
    // panel lines + ranged marker
    ctx.strokeStyle = 'rgba(60,72,78,0.28)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 14, y + 14, s - 28, s - 28);
    const cx = x + s / 2, cy = y + s / 2;
    ctx.strokeStyle = 'rgba(70,90,100,0.45)'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(cx, cy - 13); ctx.lineTo(cx + 13, cy); ctx.lineTo(cx, cy + 13); ctx.lineTo(cx - 13, cy); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = 'rgba(70,90,100,0.35)';
    ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 5, cy); ctx.closePath(); ctx.fill();
  },
  wallSide(ctx, x, y, s, r) {
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, '#6b757b'); g.addColorStop(0.5, '#4a5358'); g.addColorStop(1, '#2b3135');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x, y, s, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 1; k < 3; k++) ctx.fillRect(x + (s * k) / 3, y + 6, 2, s - 6);
    speckle(ctx, x, y + 6, s, s - 6, r, 120, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.08)']);
  },
  forbid(ctx, x, y, s, r) { forbidBase(ctx, x, y, s, r, false); },
  forbid2(ctx, x, y, s, r) { forbidBase(ctx, x, y, s, r, true); },
  forbidSide(ctx, x, y, s, r) {
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, '#3a4246'); g.addColorStop(1, '#1a1f21');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(x, y, s, 3);
    speckle(ctx, x, y, s, s, r, 80, ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.1)']);
  },
  sep(ctx, x, y, s, r) {
    ctx.fillStyle = '#15191b'; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#21272a'; ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
    ctx.save(); ctx.globalAlpha = 0.7; hazardBand(ctx, x + 3, y + s * 0.44, s - 6, s * 0.12, 8, '#c99a1c', '#151719'); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 3, y + 3, s - 6, 2);
    speckle(ctx, x + 3, y + 3, s - 6, s - 6, r, 60, ['rgba(255,255,255,0.03)', 'rgba(0,0,0,0.1)']);
  },
  sepSide(ctx, x, y, s, r) {
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, '#2c3336'); g.addColorStop(1, '#0e1112');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
    ctx.save(); ctx.globalAlpha = 0.55; hazardBand(ctx, x, y + 8, s, s * 0.12, 9, '#b8901c', '#141618'); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x, y, s, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let k = 1; k < 4; k++) ctx.fillRect(x + (s * k) / 4, y + s * 0.3, 1.5, s * 0.7);
    speckle(ctx, x, y, s, s, r, 60, ['rgba(255,255,255,0.04)']);
  },
  fence(ctx, x, y, s, r) {
    roadBase(ctx, x, y, s, r, 6);
    const b = 7;
    hazardBand(ctx, x + 3, y + 3, s - 6, b, 7);
    hazardBand(ctx, x + 3, y + s - 3 - b, s - 6, b, 7);
    ctx.save(); ctx.translate(x + 3 + b, y + 3); ctx.rotate(Math.PI / 2); hazardBand(ctx, 0, 0, s - 6, b, 7); ctx.restore();
    ctx.save(); ctx.translate(x + s - 3, y + 3); ctx.rotate(Math.PI / 2); hazardBand(ctx, 0, 0, s - 6, b, 7); ctx.restore();
    brackets(ctx, x, y, s, 17, 11, 'rgba(255,255,255,0.4)', 2.2);
  },
  fenceSide(ctx, x, y, s) {
    ctx.fillStyle = '#2b2f31'; ctx.fillRect(x, y, s, s);
    hazardBand(ctx, x, y, s, s * 0.5, 10);
  },
  start(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#5a2020', dark: '#3b1415', seamColor: '#1c0b0b', hi: 'rgba(255,120,110,0.25)', lo: 'rgba(0,0,0,0.35)' });
    ctx.save(); ctx.globalAlpha = 0.28; hazardBand(ctx, x + 6, y + 6, s - 12, s - 12, 8, '#ff3b30', 'rgba(0,0,0,0)'); ctx.restore();
    ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 4; ctx.strokeRect(x + 9, y + 9, s - 18, s - 18);
    ctx.fillStyle = 'rgba(255,90,70,0.95)';
    const cy = y + s / 2;
    for (let k = 0; k < 2; k++) {
      const cx = x + s / 2 - 12 + k * 20;
      ctx.beginPath(); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 4, cy - 14); ctx.lineTo(cx + 12, cy - 14); ctx.lineTo(cx - 2, cy);
      ctx.lineTo(cx + 12, cy + 14); ctx.lineTo(cx + 4, cy + 14); ctx.closePath(); ctx.fill();
    }
  },
  end(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#16395c', dark: '#0e2338', seamColor: '#07131f', hi: 'rgba(120,200,255,0.25)', lo: 'rgba(0,0,0,0.35)' });
    ctx.strokeStyle = '#39a7ff'; ctx.lineWidth = 4; ctx.strokeRect(x + 9, y + 9, s - 18, s - 18);
    ctx.strokeStyle = 'rgba(57,167,255,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x + 17, y + 17, s - 34, s - 34);
    // home glyph
    const cx = x + s / 2, cy = y + s / 2 + 2;
    ctx.fillStyle = 'rgba(120,205,255,0.95)';
    ctx.beginPath(); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx + 20, cy - 3); ctx.lineTo(cx + 13, cy - 3); ctx.lineTo(cx + 13, cy + 16);
    ctx.lineTo(cx - 13, cy + 16); ctx.lineTo(cx - 13, cy - 3); ctx.lineTo(cx - 20, cy - 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0e2338'; ctx.fillRect(cx - 5, cy + 3, 10, 13);
  },
  telin(ctx, x, y, s, r) { portal(ctx, x, y, s, r, '#b36bff', true); },
  telout(ctx, x, y, s, r) { portal(ctx, x, y, s, r, '#8f7bff', false); },
  hand(ctx, x, y, s, r) { benchTop(ctx, x, y, s, r, 'rgba(210,240,232,0.75)', 'rgba(78,216,175,0.10)'); },
  temp(ctx, x, y, s, r) { benchTop(ctx, x, y, s, r, 'rgba(246,163,41,0.9)', 'rgba(246,163,41,0.14)'); },
  benchSide(ctx, x, y, s, r) { benchSide(ctx, x, y, s, r, 'rgba(78,216,175,0.85)'); },
  benchSideTemp(ctx, x, y, s, r) { benchSide(ctx, x, y, s, r, 'rgba(246,163,41,0.9)'); },
  mire(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#5b5a33', dark: '#3c3d22', seamColor: '#1f2012', hi: 'rgba(220,230,150,0.14)', lo: 'rgba(0,0,0,0.3)' });
    for (let i = 0; i < 9; i++) {
      const bx = x + 12 + r() * (s - 24), by = y + 12 + r() * (s - 24), br = 6 + r() * 16;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, 'rgba(30,34,14,0.55)'); g.addColorStop(1, 'rgba(30,34,14,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(200,215,120,0.35)'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + 14 + r() * (s - 28), y + 14 + r() * (s - 28), 2 + r() * 4, 0, Math.PI * 2); ctx.stroke(); }
    speckle(ctx, x + 4, y + 4, s - 8, s - 8, r, 150, ['rgba(160,170,80,0.12)', 'rgba(0,0,0,0.1)']);
  },
  smog(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#4e5659', dark: '#394043', seamColor: '#1d2224' });
    ctx.fillStyle = '#1a1f21';
    for (let k = 0; k < 6; k++) roundRect(ctx, x + 14, y + 14 + k * 16.5, s - 28, 8, 3), ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let k = 0; k < 6; k++) ctx.fillRect(x + 16, y + 22 + k * 16.5, s - 32, 1.5);
    ctx.strokeStyle = 'rgba(150,170,160,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x + 10, y + 10, s - 20, s - 20);
  },
  deepsea(ctx, x, y, s, r) {
    const g = ctx.createLinearGradient(x, y, x + s, y + s);
    g.addColorStop(0, '#1b6f7a'); g.addColorStop(1, '#0e434d');
    ctx.fillStyle = '#0a2d33'; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = g; ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
    ctx.strokeStyle = 'rgba(160,240,255,0.22)'; ctx.lineWidth = 1.6;
    for (let i = 0; i < 9; i++) {
      const yy = y + 8 + r() * (s - 16), xx = x + r() * s * 0.5;
      ctx.beginPath(); ctx.moveTo(xx, yy);
      ctx.bezierCurveTo(xx + 15, yy - 8, xx + 30, yy + 8, xx + 45 + r() * 20, yy - 2);
      ctx.stroke();
    }
    speckle(ctx, x, y, s, s, r, 60, ['rgba(200,255,255,0.12)']);
  },
  infection(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#3a2a33', dark: '#241a20', seamColor: '#140e11', hi: 'rgba(255,140,90,0.14)' });
    for (let i = 0; i < 7; i++) {
      const cx = x + 16 + r() * (s - 32), cy = y + 16 + r() * (s - 32), rr = 5 + r() * 10, a = r() * Math.PI;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 2.2);
      g.addColorStop(0, 'rgba(255,110,60,0.45)'); g.addColorStop(1, 'rgba(255,110,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = i % 2 ? '#ff7a45' : '#ffb070';
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const aa = a + (k / 5) * Math.PI * 2, rad = k % 2 ? rr * 0.45 : rr;
        ctx.lineTo(cx + Math.cos(aa) * rad, cy + Math.sin(aa) * rad);
      }
      ctx.closePath(); ctx.fill();
    }
    cracks(ctx, x, y, s, r, 4, 'rgba(255,120,70,0.45)');
  },
  cliff(ctx, x, y, s) {
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, 'rgba(70,80,86,1)'); g.addColorStop(0.08, 'rgba(38,45,49,1)'); g.addColorStop(1, 'rgba(10,13,14,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
  },
  lowSide(ctx, x, y, s) {
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, '#59646a'); g.addColorStop(1, '#2a3034');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, y, s, 3);
  },
  blank(ctx, x, y, s) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, s, s); },
  wallL(ctx, x, y, s, r) { MAT_DRAW.wall(ctx, x, y, s, r); },
  wallM(ctx, x, y, s, r) { MAT_DRAW.wall(ctx, x, y, s, r); },
  wallR(ctx, x, y, s, r) { MAT_DRAW.wall(ctx, x, y, s, r); },
  wallB(ctx, x, y, s, r) { MAT_DRAW.wall(ctx, x, y, s, r); },
  wallVM(ctx, x, y, s, r) { MAT_DRAW.wall(ctx, x, y, s, r); },
  wallT(ctx, x, y, s, r) { MAT_DRAW.wall(ctx, x, y, s, r); },
  crateSide(ctx, x, y, s) {
    ctx.fillStyle = '#7d5529'; ctx.fillRect(x, y, s, s);
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, '#c89a5a'); g.addColorStop(1, '#9a6d38');
    ctx.fillStyle = g; ctx.fillRect(x + 6, y + 6, s - 12, s - 12);
    ctx.strokeStyle = 'rgba(90,58,24,0.55)'; ctx.lineWidth = 1.5;
    for (const f of [0.33, 0.66]) { ctx.beginPath(); ctx.moveTo(x + 6, y + s * f); ctx.lineTo(x + s - 6, y + s * f); ctx.stroke(); }
    ctx.strokeStyle = '#e0b877'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x + 8, y + 8); ctx.lineTo(x + s - 8, y + s - 8); ctx.moveTo(x + s - 8, y + 8); ctx.lineTo(x + 8, y + s - 8); ctx.stroke();
    ctx.strokeStyle = '#3c2810'; ctx.lineWidth = 6; ctx.strokeRect(x + 3, y + 3, s - 6, s - 6);
  },
  crateTop(ctx, x, y, s, r) {
    MAT_DRAW.crateSide(ctx, x, y, s, r);
    ctx.fillStyle = 'rgba(255,226,168,0.12)'; ctx.fillRect(x, y, s, s);
  },
  blowerTop(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#2c3337', dark: '#1a1f21', seamColor: '#0c0f10' });
    ctx.fillStyle = 'rgba(232,178,31,0.9)';
    for (let k = 0; k < 2; k++) {
      const cx = x + s / 2 - 16 + k * 26, cy = y + s / 2;
      ctx.beginPath(); ctx.moveTo(cx - 12, cy - 18); ctx.lineTo(cx + 12, cy); ctx.lineTo(cx - 12, cy + 18); ctx.closePath(); ctx.fill();
    }
    speckle(ctx, x, y, s, s, r, 60, ['rgba(255,255,255,0.05)']);
  },
  sealed(ctx, x, y, s, r) {
    hazardBand(ctx, x, y, s, s, 9);
    bevelTile(ctx, x + 10, y + 10, s - 20, { light: '#50585c', dark: '#3a4145', seamColor: '#23282b' });
    ctx.strokeStyle = 'rgba(200,210,215,0.8)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(x + 30, y + 30); ctx.lineTo(x + s - 30, y + s - 30); ctx.moveTo(x + s - 30, y + 30); ctx.lineTo(x + 30, y + s - 30); ctx.stroke();
  },
  turretTop(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#4b5357', dark: '#343b3e', seamColor: '#1d2224' });
    const cx = x + s / 2, cy = y + s / 2;
    ctx.strokeStyle = '#ff6a3d'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 34, cy); ctx.lineTo(cx + 34, cy); ctx.moveTo(cx, cy - 34); ctx.lineTo(cx, cy + 34); ctx.stroke();
    speckle(ctx, x, y, s, s, r, 60, ['rgba(255,255,255,0.05)']);
  },
  platformTop(ctx, x, y, s, r) {
    bevelTile(ctx, x, y, s, { light: '#8a959a', dark: '#6c777d', seamColor: '#3d4549', hi: 'rgba(255,255,255,0.4)' });
    ctx.strokeStyle = 'rgba(32,38,42,0.5)'; ctx.lineWidth = 1.5;
    for (const f of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(x + 6, y + s * f); ctx.lineTo(x + s - 6, y + s * f); ctx.stroke(); }
    speckle(ctx, x, y, s, s, r, 120, ['rgba(255,255,255,0.06)', 'rgba(0,0,0,0.08)']);
  },
  margin(ctx, x, y, s, r) {
    ctx.fillStyle = '#1b2023'; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#22282b'; ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
    speckle(ctx, x, y, s, s, r, 90, ['rgba(255,255,255,0.035)', 'rgba(0,0,0,0.12)']);
  },
};

function roadBase(ctx, x, y, s, r, variant, plain) {
  bevelTile(ctx, x, y, s, plain
    ? { light: '#838b90', dark: '#727a7f', seamColor: '#3a4246' }
    : { light: '#949ca1', dark: '#80888d', seamColor: '#3d4549' });
  speckle(ctx, x + 4, y + 4, s - 8, s - 8, r, 380, ['rgba(255,255,255,0.09)', 'rgba(0,0,0,0.09)', 'rgba(20,30,35,0.06)']);
  if (variant % 2 === 0) cracks(ctx, x, y, s, r, 2, 'rgba(30,38,42,0.25)');
  if (variant === 3) {
    const g = ctx.createRadialGradient(x + s * 0.7, y + s * 0.3, 2, x + s * 0.7, y + s * 0.3, s * 0.4);
    g.addColorStop(0, 'rgba(40,50,55,0.12)'); g.addColorStop(1, 'rgba(40,50,55,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
  }
}

function floorBase(ctx, x, y, s, r) {
  bevelTile(ctx, x, y, s, { light: '#5f676b', dark: '#51585c', seamColor: '#2b3134', hi: 'rgba(255,255,255,0.12)' });
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) ctx.fillRect(x + 12 + i * 15.5, y + 12 + j * 15.5, 3, 3);
  speckle(ctx, x + 4, y + 4, s - 8, s - 8, r, 180, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.08)']);
}

function forbidBase(ctx, x, y, s, r, alt) {
  ctx.fillStyle = '#20262a'; ctx.fillRect(x, y, s, s);
  const g = ctx.createLinearGradient(x, y, x + s, y + s);
  g.addColorStop(0, alt ? '#3a4247' : '#3d464b'); g.addColorStop(1, alt ? '#30373b' : '#333a3f');
  ctx.fillStyle = g; ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
  ctx.save();
  ctx.beginPath(); ctx.rect(x + 3, y + 3, s - 6, s - 6); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 3;
  for (let k = -s; k < s * 2; k += 13) { ctx.beginPath(); ctx.moveTo(x + k, y + s); ctx.lineTo(x + k + s, y); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 3, y + 3, s - 6, 2); ctx.fillRect(x + 3, y + 3, 2, s - 6);
  speckle(ctx, x + 3, y + 3, s - 6, s - 6, r, 100, ['rgba(255,255,255,0.03)', 'rgba(0,0,0,0.12)']);
}

function portal(ctx, x, y, s, r, color, inward) {
  bevelTile(ctx, x, y, s, { light: '#2a2236', dark: '#1a1522', seamColor: '#0e0b12' });
  const cx = x + s / 2, cy = y + s / 2;
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = color; ctx.globalAlpha = 0.9 - k * 0.25; ctx.lineWidth = 4 - k;
    ctx.beginPath(); ctx.arc(cx, cy, 14 + k * 11, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
  g.addColorStop(0, inward ? 'rgba(230,200,255,0.9)' : 'rgba(200,190,255,0.7)'); g.addColorStop(1, 'rgba(160,100,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fill();
}

function benchTop(ctx, x, y, s, r, dash, fill) {
  bevelTile(ctx, x, y, s, { light: '#323b40', dark: '#262d31', seamColor: '#15191b', hi: 'rgba(255,255,255,0.14)' });
  speckle(ctx, x + 4, y + 4, s - 8, s - 8, r, 120, ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.1)']);
  roundRect(ctx, x + 12, y + 12, s - 24, s - 24, 10);
  ctx.fillStyle = fill; ctx.fill();
  ctx.setLineDash([11, 7]); ctx.lineWidth = 3; ctx.strokeStyle = dash; ctx.stroke();
  ctx.setLineDash([]);
}

function benchSide(ctx, x, y, s, r, led) {
  const g = ctx.createLinearGradient(x, y, x, y + s);
  g.addColorStop(0, '#2c3438'); g.addColorStop(1, '#121618');
  ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, y, s, 3);
  ctx.fillStyle = led; ctx.fillRect(x, y + s * 0.34, s, s * 0.1);
}

const _atlases = new Map();   // art key → atlas

/** Procedural finishing layers usable in tiles.json (`{ proc: 'rim' }`): a bevelled block edge. */
const PROC_LAYERS = {
  /** A glossy glass pane over the inner square of a hatch: sky-lit gradient, soft cloud reflections, a highlight. */
  glass(ctx, x, y, s) {
    const i = s * 0.135, w = s - i * 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + i, y + i, w, w); ctx.clip();
    const g = ctx.createLinearGradient(x + i, y + i, x + i + w * 0.4, y + i + w);
    g.addColorStop(0, '#dfe6ec'); g.addColorStop(0.55, '#b8c3cc'); g.addColorStop(1, '#9eabb5');
    ctx.fillStyle = g; ctx.fillRect(x + i, y + i, w, w);
    const r = rng(4243);
    for (let k = 0; k < 7; k++) {
      const cx = x + i + r() * w, cy = y + i + r() * w, rad = w * (0.18 + r() * 0.22);
      const c = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      c.addColorStop(0, 'rgba(255,255,255,0.35)'); c.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = c; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(x + i, y + i); ctx.lineTo(x + i + w * 0.45, y + i); ctx.lineTo(x + i, y + i + w * 0.45); ctx.closePath(); ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.012); ctx.strokeStyle = 'rgba(40,48,54,0.55)'; ctx.strokeRect(x + i, y + i, w, w);
    ctx.restore();
  },
  rim(ctx, x, y, s) {
    ctx.save();
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.strokeRect(x + 2.5, y + 2.5, s - 5, s - 5);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.strokeRect(x + 7, y + 7, s - 14, s - 14);
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
    ctx.restore();
  },
};

/** Draw one tile-art layer (tools/crop-board-atlas.mjs schema) into the cell interior at (x, y, INNER²). */
function drawArtLayer(ctx, img, ly, x, y) {
  if (ly.proc) { PROC_LAYERS[ly.proc]?.(ctx, x, y, INNER); return; }
  const [sx, sy, sw, sh] = ly.rect;
  const sc = Number.isFinite(ly.scale) && ly.scale > 0 ? Math.min(1, ly.scale) : 1;
  const size = INNER * sc;
  // work canvas: the crop, rotated/flipped, scaled to the (decal) size; tint = multiply (alpha kept)
  const w = makeCanvas(size, size);
  const c = w.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.save();
  c.translate(size / 2, size / 2);
  const rot = ((Number(ly.rot) || 0) % 360 + 360) % 360;
  if (rot) c.rotate((rot * Math.PI) / 180);
  c.scale(ly.flipX ? -1 : 1, ly.flipY ? -1 : 1);
  c.drawImage(img, sx, sy, sw, sh, -size / 2, -size / 2, size, size);
  c.restore();
  const tint = typeof ly.tint === 'string' && /^#[0-9a-f]{6}$/i.test(ly.tint) ? ly.tint : null;
  const bright = Number.isFinite(ly.bright) ? ly.bright : 1;
  if (tint || bright !== 1) {
    c.globalCompositeOperation = 'multiply';
    if (tint) { c.fillStyle = tint; c.fillRect(0, 0, size, size); }
    if (bright < 1) { const v = Math.round(255 * Math.max(0, bright)); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(0, 0, size, size); }
    c.globalCompositeOperation = 'screen';
    if (bright > 1) { c.fillStyle = `rgba(255,255,255,${Math.min(0.6, bright - 1)})`; c.fillRect(0, 0, size, size); }
    // restore the crop's alpha (multiply/screen fill opaque pixels over transparent ones)
    c.globalCompositeOperation = 'destination-in';
    c.save();
    c.translate(size / 2, size / 2);
    if (rot) c.rotate((rot * Math.PI) / 180);
    c.scale(ly.flipX ? -1 : 1, ly.flipY ? -1 : 1);
    c.drawImage(img, sx, sy, sw, sh, -size / 2, -size / 2, size, size);
    c.restore();
    c.globalCompositeOperation = 'source-over';
  }
  ctx.save();
  ctx.globalAlpha = Number.isFinite(ly.alpha) ? Math.max(0, Math.min(1, ly.alpha)) : 1;
  ctx.drawImage(w, x + (INNER - size) / 2, y + (INNER - size) / 2);
  ctx.restore();
}

/**
 * The tile material atlas: `{ texture, uv: { [material]: [u0, v0, u1, v1] }, art: boolean, artCount }` (UVs of
 * the inner square; identical for every atlas). `art` (render/boardArt.js): `{ key, tiles: { materials }, images:
 * { D, common, … } }` — materials it describes are composed from the real board art, the rest stay procedural.
 */
export function tileAtlas(art = null) {
  const key = art && art.key ? String(art.key) : '';
  const hit = _atlases.get(key);
  if (hit) return hit;
  const P = PIXI();
  const canvas = makeCanvas(ATLAS_W, ATLAS_H);
  const ctx = canvas.getContext('2d');
  const perRow = ATLAS_W / CELL;
  const uv = {};
  let artCount = 0;
  const mats = art?.tiles?.materials && typeof art.tiles.materials === 'object' ? art.tiles.materials : null;
  MATERIALS.forEach((name, i) => {
    const cx = (i % perRow) * CELL, cy = Math.floor(i / perRow) * CELL;
    const x = cx + GUTTER, y = cy + GUTTER;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, INNER, INNER); ctx.clip();
    let drawn = false;
    const layers = mats && Array.isArray(mats[name]) ? mats[name] : (mats && art?.images?.D ? DEFAULT_ART_LAYERS[name] || null : null);
    if (layers && layers.length) {
      try {
        const ok = layers.every((ly) => ly && (PROC_LAYERS[ly.proc] || (Array.isArray(ly.rect) && ly.rect.length === 4 && art.images?.[ly.src])));
        if (ok) {
          for (const ly of layers) drawArtLayer(ctx, ly.proc ? null : art.images[ly.src], ly, x, y);
          drawn = true;
          artCount++;
        }
      } catch { drawn = false; }
    }
    if (!drawn) {
      try {
        const k = INNER / PROC_UNIT;
        ctx.translate(x, y); ctx.scale(k, k);
        MAT_DRAW[name](ctx, 0, 0, PROC_UNIT, rng(1000 + i * 7919));
      } catch { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#f0f'; ctx.fillRect(x, y, INNER, INNER); }
    }
    ctx.restore();
    // clamp gutters: stretch the edge pixels outwards
    ctx.drawImage(canvas, x, y, INNER, 1, x, cy, INNER, GUTTER);
    ctx.drawImage(canvas, x, y + INNER - 1, INNER, 1, x, y + INNER, INNER, GUTTER);
    ctx.drawImage(canvas, x, cy, 1, CELL, cx, cy, GUTTER, CELL);
    ctx.drawImage(canvas, x + INNER - 1, cy, 1, CELL, x + INNER, cy, GUTTER, CELL);
    const e = 0.5; // half-texel inset
    uv[name] = [(x + e) / ATLAS_W, (y + e) / ATLAS_H, (x + INNER - e) / ATLAS_W, (y + INNER - e) / ATLAS_H];
  });
  const base = P.BaseTexture.from(canvas, { mipmap: P.MIPMAP_MODES.ON, scaleMode: P.SCALE_MODES.LINEAR, anisotropicLevel: 8 });
  const atlas = { texture: new P.Texture(base), uv, canvas, art: artCount > 0, artCount, key };
  // keep at most the procedural atlas + one art atlas alive
  for (const [k, a] of _atlases) if (k && k !== key) { try { a.texture.destroy(true); } catch { /* ignore */ } _atlases.delete(k); }
  _atlases.set(key, atlas);
  return atlas;
}

/**
 * Repeating ground texture for the backdrop plane: the board art's BG (optionally a `crop` [x, y, w, h] of it,
 * resampled to a POT canvas so it can repeat everywhere), else a procedural dark concrete.
 */
const _groundTex = new Map();
export function groundTexture(img = null, crop = null) {
  const key = img ? `art:${crop ? crop.join(',') : ''}` : 'proc';
  let t = _groundTex.get(key);
  if (t) return t;
  const P = PIXI();
  let src = img;
  if (src && Array.isArray(crop) && crop.length === 4) {
    const c = makeCanvas(512, 512);
    const x = c.getContext('2d');
    try { x.drawImage(src, crop[0], crop[1], crop[2], crop[3], 0, 0, 512, 512); src = c; } catch { /* keep full image */ }
  }
  if (!src) {
    const c = makeCanvas(512, 512);
    const x = c.getContext('2d');
    x.fillStyle = '#2b2a2c'; x.fillRect(0, 0, 512, 512);
    speckle(x, 0, 0, 512, 512, rng(99), 5000, ['rgba(255,255,255,0.035)', 'rgba(0,0,0,0.12)', 'rgba(60,56,58,0.2)'], [1, 4]);
    for (let i = 0; i < 18; i++) radial(x, rng(i)() * 512, rng(i + 50)() * 512, 60 + rng(i + 9)() * 120, [[0, 'rgba(0,0,0,0.12)'], [1, 'rgba(0,0,0,0)']]);
    src = c;
  }
  const base = P.BaseTexture.from(src, { mipmap: P.MIPMAP_MODES.ON, scaleMode: P.SCALE_MODES.LINEAR, wrapMode: P.WRAP_MODES.REPEAT, anisotropicLevel: 2 });
  t = new P.Texture(base);
  _groundTex.set(key, t);
  return t;
}

// =============================================================================================================
// FX atlas

const FX_W = 1024, FX_H = 512;
/** Status icons: one 32 px row at the bottom of the FX atlas (frames `st_<key>`). */
const STATUS_ROW_Y = 448;
let _fx = null;

/**
 * FX atlas frames — name: [x, y, w, h, draw(ctx, x, y, w, h)]. Every frame owns its cell: no two frames share a pixel
 * (the light pillar once ran into the status-icon row, so every skill / deploy pillar carried the 'silence' and 'slow'
 * icons at its foot) and each drawing stays off its cell's outer pixel (mipmapped sampling of a small sprite must not
 * pull in a neighbour). Frame sizes are part of the API — sprites are scaled by them: glow / soft / ring / hex / shock /
 * reticle / smoke / flare 128², spark / plus / orb / chevron / boomerang / muzzle 64², coin 48², dot / shard / square
 * 32², streak / tracer / bolt 128×32 (head at the right), slash 128×64 (arc bulging up), pillar 64×256 (foot at the
 * bottom).
 */
const FX_DRAW = {
  glow: [0, 0, 128, 128, (c, x, y, w) => { radial(c, x + w / 2, y + w / 2, w / 2, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]); }],
  soft: [128, 0, 128, 128, (c, x, y, w) => { radial(c, x + w / 2, y + w / 2, w / 2, [[0, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]); }],
  ring: [256, 0, 128, 128, (c, x, y, w) => {
    const cx = x + w / 2, cy = y + w / 2;
    const g = c.createRadialGradient(cx, cy, w * 0.34, cx, cy, w * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,1)'); g.addColorStop(0.75, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(x, y, w, w);
  }],
  hex: [384, 0, 128, 128, (c, x, y, w) => {
    const cx = x + w / 2, cy = y + w / 2;
    c.strokeStyle = 'rgba(255,255,255,1)'; c.lineWidth = 5;
    c.beginPath();
    for (let k = 0; k <= 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; c.lineTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54); }
    c.stroke();
    c.lineWidth = 2; c.globalAlpha = 0.6;
    c.beginPath();
    for (let k = 0; k <= 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; c.lineTo(cx + Math.cos(a) * 42, cy + Math.sin(a) * 42); }
    c.stroke(); c.globalAlpha = 1;
    for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; c.fillStyle = '#fff'; c.fillRect(cx + Math.cos(a) * 60 - 3, cy + Math.sin(a) * 60 - 3, 6, 6); }
  }],
  // a thin sharp ring with a faint wake inside: shockwaves (skill bursts, explosions, the bombard warning)
  shock: [512, 0, 128, 128, (c, x, y, w) => {
    radial(c, x + w / 2, y + w / 2, w / 2 - 1, [[0, 'rgba(255,255,255,0)'], [0.52, 'rgba(255,255,255,0)'], [0.8, 'rgba(255,255,255,0.16)'],
      [0.9, 'rgba(255,255,255,1)'], [0.96, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
  }],
  // lock-on reticle: circle, cross ticks, corner brackets, centre dot (蕾缪安 locks, marks)
  reticle: [640, 0, 128, 128, (c, x, y, w) => {
    const cx = x + w / 2, cy = y + w / 2;
    c.strokeStyle = '#fff'; c.lineCap = 'round';
    c.lineWidth = 5; c.beginPath(); c.arc(cx, cy, 36, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2; c.globalAlpha = 0.55; c.beginPath(); c.arc(cx, cy, 27, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
    c.lineWidth = 5;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
      c.beginPath(); c.moveTo(cx + ca * 22, cy + sa * 22); c.lineTo(cx + ca * 50, cy + sa * 50); c.stroke();
    }
    c.lineWidth = 4;
    for (let k = 0; k < 4; k++) {
      const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1, bx = cx + sx * 52, by = cy + sy * 52;
      c.beginPath(); c.moveTo(bx - sx * 14, by); c.lineTo(bx, by); c.lineTo(bx, by - sy * 14); c.stroke();
    }
    c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, 4, 0, Math.PI * 2); c.fill();
  }],
  smoke: [768, 0, 128, 128, (c, x, y) => {
    const r = rng(77);
    for (let i = 0; i < 14; i++) radial(c, x + 30 + r() * 68, y + 30 + r() * 68, 18 + r() * 22, [[0, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']]);
  }],
  // star flare: hot centre, four long and four short rays (skill flash, explosion core, impacts)
  flare: [896, 0, 128, 128, (c, x, y, w) => {
    const cx = x + w / 2, cy = y + w / 2;
    radial(c, cx, cy, w / 2 - 1, [[0, 'rgba(255,255,255,0.95)'], [0.12, 'rgba(255,255,255,0.55)'], [0.4, 'rgba(255,255,255,0.1)'], [1, 'rgba(255,255,255,0)']]);
    const ray = (a, len, half) => {
      c.save(); c.translate(cx, cy); c.rotate(a);
      const g = c.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, -half); c.lineTo(len, 0); c.lineTo(0, half); c.closePath(); c.fill();
      c.restore();
    };
    for (let k = 0; k < 4; k++) ray((k * Math.PI) / 2, 60, 5);
    for (let k = 0; k < 4; k++) ray(Math.PI / 4 + (k * Math.PI) / 2, 30, 3);
  }],
  pillar: [0, 128, 64, 256, (c, x, y, w, h) => {
    const g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(x, y + 1, w, h - 2);
    const v = c.createLinearGradient(0, y, 0, y + h);
    v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.35, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = v; c.fillRect(x, y, w, h); c.globalCompositeOperation = 'source-over';
  }],
  spark: [64, 128, 64, 64, (c, x, y, w) => {
    const cx = x + w / 2, cy = y + w / 2;
    radial(c, cx, cy, w / 2, [[0, 'rgba(255,255,255,0.9)'], [0.2, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
    c.fillStyle = 'rgba(255,255,255,1)';
    c.beginPath(); c.moveTo(cx, y + 2); c.lineTo(cx + 3, cy - 3); c.lineTo(x + w - 2, cy); c.lineTo(cx + 3, cy + 3); c.lineTo(cx, y + w - 2);
    c.lineTo(cx - 3, cy + 3); c.lineTo(x + 2, cy); c.lineTo(cx - 3, cy - 3); c.closePath(); c.fill();
  }],
  plus: [128, 128, 64, 64, (c, x, y, w) => {
    const cx = x + w / 2, cy = y + w / 2;
    radial(c, cx, cy, w / 2, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    c.fillStyle = '#fff';
    c.fillRect(cx - 5, cy - 18, 10, 36); c.fillRect(cx - 18, cy - 5, 36, 10);
  }],
  orb: [192, 128, 64, 64, (c, x, y, w) => {
    radial(c, x + w / 2, y + w / 2, w / 2, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.85)'], [0.55, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
  }],
  chevron: [256, 128, 64, 64, (c, x, y) => {
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(x + 14, y + 8); c.lineTo(x + 30, y + 8); c.lineTo(x + 52, y + 32); c.lineTo(x + 30, y + 56); c.lineTo(x + 14, y + 56); c.lineTo(x + 36, y + 32); c.closePath(); c.fill();
  }],
  // 回环射手 boomerang: two curved arms meeting at an elbow, centred on the cell (it spins about the centre)
  boomerang: [320, 128, 64, 64, (c, x, y, w) => {
    c.save(); c.translate(x + w / 2, y + w / 2 + 3);
    c.beginPath();
    c.moveTo(0, -21);
    c.quadraticCurveTo(19, -17, 27, 14); c.quadraticCurveTo(21, 18, 14, 11); c.quadraticCurveTo(8, -5, 0, -8);
    c.quadraticCurveTo(-8, -5, -14, 11); c.quadraticCurveTo(-21, 18, -27, 14); c.quadraticCurveTo(-19, -17, 0, -21);
    c.closePath();
    c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();
    c.lineWidth = 2.5; c.lineJoin = 'round'; c.strokeStyle = '#fff'; c.stroke();
    c.restore();
  }],
  // muzzle flash pointing right (+x) from a hot spot at (12, 32): sprite anchor (0.19, 0.5), rotated to the shot
  muzzle: [384, 128, 64, 64, (c, x, y, w, h) => {
    const cx = x + 12, cy = y + h / 2;
    radial(c, cx, cy, 11, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
    const g = c.createLinearGradient(cx, 0, x + w - 2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(cx, cy - 7); c.quadraticCurveTo(cx + 26, cy - 12, x + w - 2, cy); c.quadraticCurveTo(cx + 26, cy + 12, cx, cy + 7); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(cx + 2, cy - 3); c.lineTo(cx + 18, cy - 19); c.lineTo(cx + 9, cy); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(cx + 2, cy + 3); c.lineTo(cx + 18, cy + 19); c.lineTo(cx + 9, cy); c.closePath(); c.fill();
  }],
  coin: [448, 128, 48, 48, (c, x, y, w) => {
    const cx = x + w / 2, cy = y + w / 2;
    c.fillStyle = '#ffc600'; c.beginPath(); c.arc(cx, cy, 20, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff2a8'; c.beginPath(); c.arc(cx - 4, cy - 4, 11, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c98f00'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', cx, cy + 1);
  }],
  dot: [512, 128, 32, 32, (c, x, y, w) => { radial(c, x + w / 2, y + w / 2, w / 2, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]); }],
  shard: [544, 128, 32, 32, (c, x, y, w) => {
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x + w / 2, y + 1); c.lineTo(x + w - 8, y + w / 2); c.lineTo(x + w / 2, y + w - 1); c.lineTo(x + 8, y + w / 2); c.closePath(); c.fill();
  }],
  square: [576, 128, 32, 32, (c, x, y, w) => { c.fillStyle = '#fff'; c.fillRect(x + 1, y + 1, w - 2, w - 2); }],
  // melee swing: a thick crescent (arc bulging up), hot in the middle, tips fading, a bright rim
  slash: [640, 128, 128, 64, (c, x, y, w, h) => {
    const cx = x + w / 2;
    const g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.28, 'rgba(255,255,255,0.8)'); g.addColorStop(0.55, 'rgba(255,255,255,1)');
    g.addColorStop(0.82, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.save(); c.beginPath(); c.rect(x + 1, y + 1, w - 2, h - 2); c.clip();
    c.beginPath();
    c.ellipse(cx, y + h * 1.2, w * 0.47, h, 0, Math.PI, 0);
    c.ellipse(cx, y + h * 1.42, w * 0.43, h, 0, 0, Math.PI, true);
    c.closePath();
    c.globalAlpha = 0.85; c.fillStyle = g; c.fill(); c.globalAlpha = 1;
    c.lineWidth = 3; c.strokeStyle = g;
    c.beginPath(); c.ellipse(cx, y + h * 1.2, w * 0.47, h, 0, Math.PI * 1.06, Math.PI * 1.94); c.stroke();
    c.restore();
  }],
  // soft trail (orbs, shells, dashes): tapered band with a soft cross-section, transparent tail at the left
  streak: [768, 128, 128, 32, (c, x, y, w, h) => {
    const cy = y + h / 2;
    const v = c.createLinearGradient(0, cy - 10, 0, cy + 10);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.5, 'rgba(255,255,255,0.95)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = v;
    c.beginPath(); c.moveTo(x + 1, cy - 2); c.lineTo(x + w - 14, cy - 10); c.quadraticCurveTo(x + w - 1, cy, x + w - 14, cy + 10); c.lineTo(x + 1, cy + 2); c.closePath(); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(x + 1, cy - 0.5); c.lineTo(x + w - 10, cy - 2.5); c.lineTo(x + w - 4, cy); c.lineTo(x + w - 10, cy + 2.5); c.lineTo(x + 1, cy + 0.5); c.closePath(); c.fill();
    fadeTail(c, x, y, w, h, 0.6);
  }],
  // bullet tracer: glow band + hot core line + bright head at the right
  tracer: [768, 160, 128, 32, (c, x, y, w, h) => {
    const cy = y + h / 2;
    const v = c.createLinearGradient(0, y + 1, 0, y + h - 1);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.32, 'rgba(255,255,255,0.22)'); v.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    v.addColorStop(0.68, 'rgba(255,255,255,0.22)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = v; c.fillRect(x + 1, y + 1, w - 10, h - 2);
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(x + 1, cy - 0.8); c.lineTo(x + w - 10, cy - 2.6); c.lineTo(x + w - 10, cy + 2.6); c.lineTo(x + 1, cy + 0.8); c.closePath(); c.fill();
    fadeTail(c, x, y, w, h, 0.45);
    radial(c, x + w - 10, cy, 9, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]);
  }],
  bolt: [896, 128, 128, 32, (c, x, y, w, h) => {
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(x + 1, y, w - 2, h);
  }],
};

function radial(c, cx, cy, r, stops) {
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** Fade a horizontal frame towards its tail (left edge transparent → `mid` alpha at 55 % → opaque head at the right). */
function fadeTail(c, x, y, w, h, mid) {
  c.globalCompositeOperation = 'destination-in';
  const g = c.createLinearGradient(x, 0, x + w - 8, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, `rgba(255,255,255,${mid})`); g.addColorStop(1, 'rgba(255,255,255,1)');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.globalCompositeOperation = 'source-over';
}

/** The FX atlas layout (no canvas needed): `{ size: [w, h], frames: { name: [x, y, w, h] } }` incl. `st_<key>` icons. */
export function fxFrames() {
  const frames = {};
  for (const [name, [x, y, w, h]] of Object.entries(FX_DRAW)) frames[name] = [x, y, w, h];
  STATUS_KEYS.forEach((k, i) => { frames['st_' + k] = [(i % 32) * 32, STATUS_ROW_Y + Math.floor(i / 32) * 32, 32, 32]; });
  return { size: [FX_W, FX_H], frames };
}

/** FX atlas: `{ base, tex: { [name]: PIXI.Texture } }` (all frames share one base texture). */
export function fxAtlas() {
  if (_fx) return _fx;
  const P = PIXI();
  const canvas = makeCanvas(FX_W, FX_H);
  const ctx = canvas.getContext('2d');
  const { frames } = fxFrames();
  for (const [name, [x, y, w, h, draw]] of Object.entries(FX_DRAW)) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    try { draw(ctx, x, y, w, h); } catch { /* keep blank */ }
    ctx.restore();
  }
  for (const k of STATUS_KEYS) {
    const [x, y] = frames['st_' + k];
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, 32, 32); ctx.clip();
    try { drawStatusIcon(ctx, k, x, y, 32); } catch { /* ignore */ }
    ctx.restore();
  }
  const base = P.BaseTexture.from(canvas, { mipmap: P.MIPMAP_MODES.ON });
  const tex = {};
  for (const [name, [x, y, w, h]] of Object.entries(frames)) tex[name] = new P.Texture(base, new P.Rectangle(x, y, w, h));
  _fx = { base, tex, canvas };
  return _fx;
}

export const STATUS_KEYS = ['stun', 'freeze', 'cold', 'stealth', 'shield', 'fragile', 'sleep', 'invuln', 'silence', 'slow', 'bind', 'fear', 'weaken', 'levitate', 'taunt', 'burn', 'neural', 'necrosis', 'blocked', 'skill', 'doll', 'healFree', 'refraction'];

function drawStatusIcon(c, key, x, y, s) {
  const cx = x + s / 2, cy = y + s / 2;
  const disc = (fill, stroke) => {
    c.fillStyle = fill; c.beginPath(); c.arc(cx, cy, s / 2 - 1.5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = stroke; c.lineWidth = 1.6; c.stroke();
  };
  c.lineCap = 'round'; c.lineJoin = 'round';
  switch (key) {
    case 'stun': {
      disc('rgba(40,32,8,0.92)', '#ffd84a');
      c.fillStyle = '#ffd84a';
      for (let k = 0; k < 3; k++) { const a = (k * Math.PI * 2) / 3 - Math.PI / 2; star(c, cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, 5, 2.2); }
      break;
    }
    case 'freeze': case 'cold': {
      disc(key === 'freeze' ? 'rgba(10,40,70,0.95)' : 'rgba(10,30,50,0.9)', '#9fd4ff');
      c.strokeStyle = key === 'freeze' ? '#e8f6ff' : '#9fd4ff'; c.lineWidth = 2;
      for (let k = 0; k < 3; k++) { const a = (k * Math.PI) / 3; c.beginPath(); c.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10); c.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10); c.stroke(); }
      if (key === 'freeze') { c.strokeStyle = '#9fd4ff'; c.strokeRect(cx - 4, cy - 4, 8, 8); }
      break;
    }
    case 'stealth': {
      disc('rgba(25,25,35,0.9)', '#b9b3d6');
      c.strokeStyle = '#d8d2f5'; c.lineWidth = 2;
      c.beginPath(); c.ellipse(cx, cy, 10, 6, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(cx - 10, cy + 9); c.lineTo(cx + 10, cy - 9); c.stroke();
      break;
    }
    case 'shield': case 'invuln': {
      disc(key === 'invuln' ? 'rgba(60,45,5,0.92)' : 'rgba(20,35,50,0.92)', key === 'invuln' ? '#ffd84a' : '#dfe8ff');
      c.fillStyle = key === 'invuln' ? '#ffd84a' : '#dfe8ff';
      c.beginPath(); c.moveTo(cx, cy - 10); c.lineTo(cx + 9, cy - 6); c.lineTo(cx + 8, cy + 3); c.lineTo(cx, cy + 10); c.lineTo(cx - 8, cy + 3); c.lineTo(cx - 9, cy - 6); c.closePath(); c.fill();
      break;
    }
    case 'fragile': case 'weaken': {
      disc('rgba(60,15,20,0.92)', '#ff7b8a');
      c.strokeStyle = '#ff9aa6'; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(cx - 3, cy - 11); c.lineTo(cx + 2, cy - 3); c.lineTo(cx - 3, cy + 2); c.lineTo(cx + 3, cy + 11); c.stroke();
      if (key === 'weaken') { c.beginPath(); c.moveTo(cx + 6, cy - 6); c.lineTo(cx + 6, cy + 6); c.moveTo(cx + 3, cy + 3); c.lineTo(cx + 6, cy + 7); c.lineTo(cx + 9, cy + 3); c.stroke(); }
      break;
    }
    case 'sleep': {
      disc('rgba(20,25,50,0.92)', '#a8b6ff');
      c.fillStyle = '#d8e0ff'; c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Zz', cx, cy + 1);
      break;
    }
    case 'refraction': {
      // 折射: a split beam. Drawn only while the buff is on; units.js drops it under silence.
      disc('rgba(12,36,48,0.92)', '#7ee0ff');
      c.strokeStyle = '#d8f7ff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx - 8, cy + 6); c.lineTo(cx - 1, cy - 8); c.lineTo(cx + 8, cy + 6); c.moveTo(cx + 2, cy - 2); c.lineTo(cx + 9, cy - 8); c.stroke();
      break;
    }
    case 'silence': {
      disc('rgba(45,20,55,0.92)', '#e08bff');
      c.strokeStyle = '#f0c4ff'; c.lineWidth = 2.2;
      c.beginPath(); c.arc(cx, cy, 8, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(cx - 6, cy + 6); c.lineTo(cx + 6, cy - 6); c.stroke();
      break;
    }
    case 'slow': case 'bind': {
      disc('rgba(15,40,35,0.92)', '#6fe0c0');
      c.strokeStyle = '#a8ffe6'; c.lineWidth = 2.2;
      if (key === 'slow') { c.beginPath(); c.moveTo(cx + 6, cy - 7); c.lineTo(cx - 2, cy); c.lineTo(cx + 6, cy + 7); c.moveTo(cx, cy - 7); c.lineTo(cx - 8, cy); c.lineTo(cx, cy + 7); c.stroke(); }
      else { c.beginPath(); c.arc(cx - 4, cy, 5, 0, Math.PI * 2); c.arc(cx + 4, cy, 5, 0, Math.PI * 2); c.stroke(); }
      break;
    }
    case 'fear': {
      disc('rgba(50,10,40,0.92)', '#ff6ad5');
      c.fillStyle = '#ffb3ec'; c.font = 'bold 18px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', cx, cy + 1);
      break;
    }
    case 'levitate': {
      disc('rgba(20,30,55,0.92)', '#8fb8ff');
      c.strokeStyle = '#cfe0ff'; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(cx, cy + 9); c.lineTo(cx, cy - 8); c.moveTo(cx - 6, cy - 2); c.lineTo(cx, cy - 9); c.lineTo(cx + 6, cy - 2); c.stroke();
      break;
    }
    case 'taunt': {
      disc('rgba(55,30,10,0.92)', '#ffb347');
      c.fillStyle = '#ffd08a'; c.beginPath(); c.moveTo(cx, cy - 10); c.lineTo(cx + 9, cy + 8); c.lineTo(cx - 9, cy + 8); c.closePath(); c.fill();
      break;
    }
    case 'burn': case 'neural': case 'necrosis': {
      const col = key === 'burn' ? '#ff7b3a' : key === 'neural' ? '#ff5ad0' : '#9dff6a';
      disc('rgba(30,20,20,0.92)', col);
      c.fillStyle = col;
      c.beginPath(); c.moveTo(cx, cy - 11); c.quadraticCurveTo(cx + 10, cy, cx + 5, cy + 8); c.quadraticCurveTo(cx, cy + 12, cx - 5, cy + 8); c.quadraticCurveTo(cx - 10, cy, cx, cy - 11); c.fill();
      break;
    }
    case 'blocked': {
      c.fillStyle = '#ff9c33';
      c.beginPath(); c.moveTo(cx - 12, cy - 9); c.lineTo(cx - 4, cy - 9); c.lineTo(cx + 5, cy); c.lineTo(cx - 4, cy + 9); c.lineTo(cx - 12, cy + 9); c.lineTo(cx - 3, cy); c.closePath(); c.fill();
      break;
    }
    case 'skill': {
      disc('rgba(60,40,5,0.92)', '#ffe066');
      c.fillStyle = '#ffe066'; star(c, cx, cy, 10, 4.5);
      break;
    }
    case 'doll': {
      // a 傀儡师's <替身>: a puppet hanging from two strings
      disc('rgba(40,25,55,0.92)', '#d8b0ff');
      c.strokeStyle = '#f0dcff'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(cx - 6, cy - 12); c.lineTo(cx - 6, cy - 1); c.moveTo(cx + 6, cy - 12); c.lineTo(cx + 6, cy - 1); c.stroke();
      c.fillStyle = '#f0dcff';
      c.beginPath(); c.arc(cx, cy - 5, 3.2, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(cx - 6, cy - 1); c.lineTo(cx + 6, cy - 1); c.lineTo(cx + 3, cy + 5); c.lineTo(cx + 5, cy + 11); c.lineTo(cx + 1.5, cy + 11);
      c.lineTo(cx, cy + 6); c.lineTo(cx - 1.5, cy + 11); c.lineTo(cx - 5, cy + 11); c.lineTo(cx - 3, cy + 5); c.closePath(); c.fill();
      break;
    }
    case 'healFree': { // 禁疗: a green heal cross struck through in red
      disc('rgba(15,40,20,0.92)', '#7ee08a');
      c.fillStyle = '#9dffa8';
      c.fillRect(cx - 2.5, cy - 9, 5, 18); c.fillRect(cx - 9, cy - 2.5, 18, 5);
      c.strokeStyle = '#ff5a5a'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(cx - 10, cy + 10); c.lineTo(cx + 10, cy - 10); c.stroke();
      break;
    }
    default: disc('rgba(30,30,30,0.9)', '#ccc');
  }
}

function star(c, cx, cy, R, r) {
  c.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? r : R; c.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
  c.closePath(); c.fill();
}

/** Icon texture for a status key (b.ev 'status' key or a flag name); null when unknown. */
export function statusTexture(key) {
  const k = STATUS_KEYS.includes(key) ? key : statusIconKey(key);
  return k ? fxAtlas().tex['st_' + k] || null : null;
}

// =============================================================================================================
// Tier chips (roman numerals), backdrop

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
let _chips = null;

function drawChips(c, w, h) {
  c.clearRect(0, 0, w * 7, h * 2);
  for (let g = 0; g < 2; g++) for (let t = 1; t <= 6; t++) {
    const x = t * w, y = g * h;
    c.save();
    roundRect(c, x + 3, y + 3, w - 6, h - 6, 7);
    const grad = c.createLinearGradient(0, y, 0, y + h);
    if (g) { grad.addColorStop(0, '#ffe27a'); grad.addColorStop(1, '#d99a00'); }
    else { grad.addColorStop(0, '#2c3335'); grad.addColorStop(1, '#111516'); }
    c.fillStyle = grad; c.fill();
    c.lineWidth = 2.5; c.strokeStyle = g ? '#fff3b8' : 'rgba(210,225,220,0.55)'; c.stroke();
    c.fillStyle = g ? '#2a1a00' : '#f2f2f2';
    c.font = `700 ${t >= 4 ? 24 : 27}px Bender, Oxanium, "Segoe UI", sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(ROMAN[t], x + w / 2, y + h / 2 + 1.5);
    c.restore();
  }
}

/** Tier chip texture: tier 1–6, golden → gold plate. */
export function tierChip(tier, golden) {
  if (!_chips) {
    const P = PIXI();
    const w = 64, h = 44;
    const canvas = makeCanvas(w * 7, h * 2);
    const base = P.BaseTexture.from(canvas);
    _chips = { canvas, base, tex: new Map(), w, h };
    drawChips(canvas.getContext('2d'), w, h);
    base.update();
  }
  const t = Math.max(1, Math.min(6, tier | 0 || 1));
  const key = `${t}:${golden ? 1 : 0}`;
  let tex = _chips.tex.get(key);
  if (!tex) {
    const P = PIXI();
    tex = new P.Texture(_chips.base, new P.Rectangle(t * _chips.w, (golden ? 1 : 0) * _chips.h, _chips.w, _chips.h));
    _chips.tex.set(key, tex);
  }
  return tex;
}

/**
 * Redraw the chip glyphs once web fonts finished loading (Bender): in place, on the same canvas / base texture, so
 * chips already handed out update too and no canvas is left behind (every field-view mount calls this).
 */
export function refreshTierChips() {
  if (!_chips) return;
  try {
    drawChips(_chips.canvas.getContext('2d'), _chips.w, _chips.h);
    _chips.base.update();
  } catch { /* keep the old glyphs */ }
}

let _bg = null;
/** Backdrop textures: vertical gradient + vignette. */
export function backdropTextures() {
  if (_bg) return _bg;
  const P = PIXI();
  const g = makeCanvas(4, 512);
  const c = g.getContext('2d');
  const lg = c.createLinearGradient(0, 0, 0, 512);
  lg.addColorStop(0, '#0a0e0d'); lg.addColorStop(0.45, '#141c1a'); lg.addColorStop(0.75, '#0f1413'); lg.addColorStop(1, '#060808');
  c.fillStyle = lg; c.fillRect(0, 0, 4, 512);
  const v = makeCanvas(512, 512);
  const vc = v.getContext('2d');
  const rg = vc.createRadialGradient(256, 230, 60, 256, 256, 360);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.7, 'rgba(0,0,0,0.25)'); rg.addColorStop(1, 'rgba(0,0,0,0.75)');
  vc.fillStyle = rg; vc.fillRect(0, 0, 512, 512);
  const grid = makeCanvas(64, 64);
  const gc = grid.getContext('2d');
  gc.strokeStyle = 'rgba(78,216,175,0.05)'; gc.lineWidth = 1;
  gc.beginPath(); gc.moveTo(0.5, 0); gc.lineTo(0.5, 64); gc.moveTo(0, 0.5); gc.lineTo(64, 0.5); gc.stroke();
  gc.fillStyle = 'rgba(78,216,175,0.08)'; gc.fillRect(0, 0, 2, 2);
  _bg = {
    gradient: P.Texture.from(g),
    vignette: P.Texture.from(v),
    grid: P.Texture.from(grid),
    red: redVignette(P),
  };
  return _bg;
}

function redVignette(P) {
  const v = makeCanvas(256, 256);
  const c = v.getContext('2d');
  const rg = c.createRadialGradient(128, 128, 70, 128, 128, 182);
  rg.addColorStop(0, 'rgba(255,40,30,0)'); rg.addColorStop(1, 'rgba(255,40,30,0.9)');
  c.fillStyle = rg; c.fillRect(0, 0, 256, 256);
  return P.Texture.from(v);
}

// =============================================================================================================
// Fallback portraits: avatar in a rarity-coloured diamond

const _diamonds = new Map();   // LRU (insertion order = recency)
const DIAMOND_PX = 160;
const DIAMOND_MAX = 160;       // ≈ 16 MB of 160×160 canvases at most (plus the ones views still show)

/**
 * Diamond composite texture for a unit (cached by key). `img` may be null (procedural glyph).
 * @param {string} key cache key
 * @param {HTMLImageElement|null} img
 * @param {number} color frame colour (0xRRGGBB)
 * @param {{ enemy?: boolean, golden?: boolean }} [o]
 */
export function diamondTexture(key, img, color, o = {}) {
  const k = `${key}|${img ? 1 : 0}|${color}|${o.golden ? 1 : 0}|${o.ice ? 1 : 0}`;
  let tex = _diamonds.get(k);
  if (tex) { _diamonds.delete(k); _diamonds.set(k, tex); return tex; }
  const P = PIXI();
  const S = DIAMOND_PX, h = S / 2;
  const canvas = makeCanvas(S, S);
  const c = canvas.getContext('2d');
  const col = '#' + (color >>> 0).toString(16).padStart(6, '0');
  const path = (inset) => { c.beginPath(); c.moveTo(h, inset); c.lineTo(S - inset, h); c.lineTo(h, S - inset); c.lineTo(inset, h); c.closePath(); };
  // glow
  c.save(); c.shadowColor = col; c.shadowBlur = 14; path(10); c.fillStyle = '#0d1112'; c.fill(); c.restore();
  // picture
  c.save(); path(16); c.clip();
  c.fillStyle = o.enemy ? '#2a1414' : '#1b2224'; c.fillRect(0, 0, S, S);
  if (img && img.width) {
    const sc = Math.max((S - 20) / img.width, (S - 20) / img.height) * 1.02;
    const w = img.width * sc, hh = img.height * sc;
    try { c.drawImage(img, h - w / 2, h - hh / 2, w, hh); } catch { /* tainted/broken image */ }
  } else if (o.ice) {
    // 圣聆初雪's frozen gate (保护目标（冻结状态）, PRTS 无头像, no model in the manifest): a snowflake on a frosty field
    const g = c.createRadialGradient(h, h, 4, h, h, h);
    g.addColorStop(0, 'rgba(205,240,255,0.95)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    c.strokeStyle = '#f2fbff'; c.lineWidth = 6; c.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3, x1 = h + Math.cos(a) * 34, y1 = h + Math.sin(a) * 34;
      c.beginPath(); c.moveTo(h, h); c.lineTo(x1, y1); c.stroke();
      const bx = h + Math.cos(a) * 20, by = h + Math.sin(a) * 20;
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(a + s * 0.8) * 11, by + Math.sin(a + s * 0.8) * 11); c.stroke(); }
    }
  } else {
    // procedural glyph (e.g. 心烛 enemy_5601_entlec has no art anywhere)
    const g = c.createRadialGradient(h, h, 4, h, h, h);
    g.addColorStop(0, o.enemy ? 'rgba(255,140,90,0.9)' : 'rgba(140,255,220,0.8)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    c.fillStyle = o.enemy ? '#ffd2b0' : '#d8fff2';
    c.beginPath(); c.moveTo(h, h - 34); c.quadraticCurveTo(h + 26, h, h + 12, h + 22); c.quadraticCurveTo(h, h + 32, h - 12, h + 22); c.quadraticCurveTo(h - 26, h, h, h - 34); c.fill();
  }
  const shade = c.createLinearGradient(0, 0, 0, S);
  shade.addColorStop(0.55, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.45)');
  c.fillStyle = shade; c.fillRect(0, 0, S, S);
  c.restore();
  // frame
  path(12); c.lineWidth = 7; c.strokeStyle = col; c.stroke();
  path(12); c.lineWidth = 2; c.strokeStyle = o.golden ? '#fff3b8' : 'rgba(255,255,255,0.55)'; c.stroke();
  if (o.golden) { path(4); c.lineWidth = 2.5; c.strokeStyle = 'rgba(255,214,90,0.9)'; c.stroke(); }
  // not registered in PIXI's global texture caches: an evicted diamond is only dropped from this LRU (a view may
  // still show it) and is garbage once no sprite uses it (the renderer's texture GC frees its GPU copy)
  tex = new P.Texture(new P.BaseTexture(canvas));
  _diamonds.set(k, tex);
  while (_diamonds.size > DIAMOND_MAX) _diamonds.delete(_diamonds.keys().next().value);
  return tex;
}

const _silhouettes = new WeakMap(); // image → texture (field views are mounted once per match: one canvas per image)
/** White copy of an image's alpha (so a dark silhouette can be tinted to any colour). Cached per image. */
export function silhouetteTexture(img) {
  const hit = img && typeof img === 'object' ? _silhouettes.get(img) : null;
  if (hit && !hit.destroyed && hit.baseTexture && !hit.baseTexture.destroyed) return hit;
  const P = PIXI();
  const c = makeCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  const tex = P.Texture.from(c);
  if (img && typeof img === 'object') _silhouettes.set(img, tex);
  return tex;
}

let _shadow = null;
/** Soft elliptical shadow (used when the asset sprite is missing). */
export function shadowTexture() {
  if (_shadow) return _shadow;
  const P = PIXI();
  const c = makeCanvas(256, 96);
  const x = c.getContext('2d');
  x.save(); x.scale(1, 96 / 256);
  const g = x.createRadialGradient(128, 128, 10, 128, 128, 124);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.6, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.restore();
  _shadow = P.Texture.from(c);
  return _shadow;
}

/** Item pedestal composite (icon in a rounded frame coloured by tier). */
const _items = new Map();
export function itemTexture(key, img, color) {
  const k = `${key}|${img ? 1 : 0}|${color}`;
  let tex = _items.get(k);
  if (tex) return tex;
  const P = PIXI();
  const S = 128;
  const canvas = makeCanvas(S, S);
  const c = canvas.getContext('2d');
  const col = '#' + (color >>> 0).toString(16).padStart(6, '0');
  c.save(); c.shadowColor = col; c.shadowBlur = 12;
  roundRect(c, 14, 14, S - 28, S - 28, 16); c.fillStyle = '#101517'; c.fill(); c.restore();
  roundRect(c, 14, 14, S - 28, S - 28, 16); c.lineWidth = 5; c.strokeStyle = col; c.stroke();
  if (img && img.width) {
    const sc = Math.min((S - 40) / img.width, (S - 40) / img.height);
    try { c.drawImage(img, S / 2 - (img.width * sc) / 2, S / 2 - (img.height * sc) / 2, img.width * sc, img.height * sc); } catch { /* ignore */ }
  } else {
    c.fillStyle = col; c.font = 'bold 44px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', S / 2, S / 2 + 2);
  }
  tex = P.Texture.from(canvas);
  _items.set(k, tex);
  return tex;
}

// =============================================================================================================
// HUD rings (user playtest #4 items 8 and 9): the element icon of a unit's gauge row (PRTS 元素: "模型下部会显示对应的元素
// 图标，并以白条显示剩余的元素值" — operators: the element's disc with its glyph; enemies: "小尺寸图标（不显示元素图标，
// 仅根据元素种类改变背景色）"; the white bar beside it — in the element's `tint` while it refills over a 爆发冷却 — is a
// plain sprite, render/units.js; since user playtest #6 the gauge is no ring any more, and the discs have a light rim),
// and the redeploy countdown ring above a knocked-out operator. One 512×576 atlas: RING_STEPS + 1 arc frames (white,
// clockwise from 12 o'clock) and the discs.
// Official element colours / glyphs after the client icons (图标 元素 sanity / water / fire / dark), drawn procedurally
// (the local-client extraction has no general battle HUD sprites).

/** Arc frames: `arcs[k]` covers k / RING_STEPS of the circle. */
export const RING_STEPS = 48;
/**
 * Element disc colours (official icons: 神经 teal, 侵蚀 steel blue, 灼燃 rust, 凋亡 charcoal) and glyph colours; `tint` =
 * the element's bright colour (the gauge bar refilling over a 爆发冷却, render/units.js).
 */
export const ELEMENT_RING = Object.freeze({
  neural: Object.freeze({ disc: '#13806c', glyph: '#bfe6df', tint: 0x1fae93 }),
  erosion: Object.freeze({ disc: '#2d5d86', glyph: '#cfdcea', tint: 0x4a8cc4 }),
  burn: Object.freeze({ disc: '#8f3512', glyph: '#f0cdbd', tint: 0xe0632c }),
  apoptosis: Object.freeze({ disc: '#363338', glyph: '#bdb8c2', tint: 0x9c8fb0 }),
  necrosis: Object.freeze({ disc: '#363338', glyph: '#bdb8c2', tint: 0x9c8fb0 }),
});
const RING_KEYS = Object.keys(ELEMENT_RING);
const RC = 64;              // cell px
const RING_R = 26, RING_W = 6.5, DISC_R = 21.5;
/** The element disc's diameter as a share of its atlas cell (a sprite `d / HUD_DISC` px wide draws a `d` px disc). */
export const HUD_DISC = (2 * DISC_R) / RC;
let _rings = null;

/**
 * The rim of an element disc: a light inner ring (about 1 px at the drawn size) inside a dark edge, so the dark discs
 * (凋亡) stay readable on the dark ground (user playtest #6) [ASSUMED look].
 */
function discRim(c, cx, cy) {
  c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 3;
  c.beginPath(); c.arc(cx, cy, DISC_R - 2.5, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 1.5;
  c.beginPath(); c.arc(cx, cy, DISC_R, 0, Math.PI * 2); c.stroke();
}

function drawElementGlyph(c, el, cx, cy, col) {
  c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
  if (el === 'neural') {           // concentric target
    c.lineWidth = 2.4;
    c.beginPath(); c.arc(cx, cy, 12, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, 7, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, 2.6, 0, Math.PI * 2); c.fill();
  } else if (el === 'erosion') {   // a big and a small water drop over a wave
    const drop = (x, y, r) => {
      c.beginPath(); c.moveTo(x, y - r * 2.1);
      c.bezierCurveTo(x + r * 0.5, y - r * 1.2, x + r, y - r * 0.5, x + r, y + r * 0.1);
      c.arc(x, y + r * 0.1, r, 0, Math.PI);
      c.bezierCurveTo(x - r, y - r * 0.5, x - r * 0.5, y - r * 1.2, x, y - r * 2.1); c.fill();
    };
    drop(cx - 3, cy - 1, 5.6); drop(cx + 7.5, cy + 2, 3.1);
    c.lineWidth = 2.2; c.beginPath(); c.moveTo(cx - 13, cy + 11); c.quadraticCurveTo(cx - 6.5, cy + 7, cx, cy + 11); c.quadraticCurveTo(cx + 6.5, cy + 15, cx + 13, cy + 11); c.stroke();
  } else if (el === 'burn') {      // flame
    c.beginPath(); c.moveTo(cx, cy - 13); c.quadraticCurveTo(cx + 11, cy - 1, cx + 7, cy + 9); c.quadraticCurveTo(cx, cy + 14, cx - 7, cy + 9);
    c.quadraticCurveTo(cx - 11, cy - 1, cx - 2, cy - 5); c.quadraticCurveTo(cx - 1, cy - 9, cx, cy - 13); c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.moveTo(cx, cy - 1); c.quadraticCurveTo(cx + 5, cy + 5, cx + 2, cy + 9); c.quadraticCurveTo(cx - 2, cy + 11, cx - 4, cy + 7); c.quadraticCurveTo(cx - 4, cy + 3, cx, cy - 1); c.fill();
    c.globalCompositeOperation = 'source-over';
  } else {                         // 凋亡: an eye-like lozenge
    c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(cx - 13, cy); c.lineTo(cx, cy - 8); c.lineTo(cx + 13, cy); c.lineTo(cx, cy + 8); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(cx - 6, cy); c.lineTo(cx, cy - 3.5); c.lineTo(cx + 6, cy); c.lineTo(cx, cy + 3.5); c.closePath(); c.fill();
  }
}

/**
 * The HUD ring atlas: `{ arcs: Texture[RING_STEPS + 1], track, disc: { [element]: Texture }, discEnemy: { [element] },
 * downDisc }` — every frame RC px square, centred on the ring centre (anchor 0.5). Built once, lazily.
 */
export function hudRings() {
  if (_rings) return _rings;
  const P = PIXI();
  const W = 8 * RC, rowsArc = Math.ceil((RING_STEPS + 1) / 8), H = (rowsArc + 2) * RC;
  const canvas = makeCanvas(W, H);
  const c = canvas.getContext('2d');
  const cell = (i) => [(i % 8) * RC, Math.floor(i / 8) * RC];
  const frames = { arcs: [] };
  // arcs: white with a thin dark edge (readable on light and dark ground)
  for (let k = 0; k <= RING_STEPS; k++) {
    const [x, y] = cell(k);
    frames.arcs.push([x, y]);
    if (!k) continue;
    const cx = x + RC / 2, cy = y + RC / 2, a0 = -Math.PI / 2, a1 = a0 + (Math.PI * 2 * k) / RING_STEPS;
    c.lineCap = k === RING_STEPS ? 'butt' : 'round';
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = RING_W + 2.5;
    c.beginPath(); c.arc(cx, cy, RING_R, a0, a1); c.stroke();
    c.strokeStyle = '#ffffff'; c.lineWidth = RING_W;
    c.beginPath(); c.arc(cx, cy, RING_R, a0, a1); c.stroke();
  }
  const row = rowsArc * RC;
  // row A: ally discs (with glyph), the track ring, the dark disc of the redeploy ring
  RING_KEYS.forEach((el, i) => {
    const x = i * RC, cx = x + RC / 2, cy = row + RC / 2;
    c.fillStyle = ELEMENT_RING[el].disc; c.beginPath(); c.arc(cx, cy, DISC_R, 0, Math.PI * 2); c.fill();
    c.save(); c.beginPath(); c.arc(cx, cy, DISC_R - 1, 0, Math.PI * 2); c.clip();
    drawElementGlyph(c, el, cx, cy, ELEMENT_RING[el].glyph);
    c.restore();
    discRim(c, cx, cy);
    frames['a:' + el] = [x, row];
  });
  {
    const x = RING_KEYS.length * RC, cx = x + RC / 2, cy = row + RC / 2;
    c.strokeStyle = 'rgba(12,16,15,0.72)'; c.lineWidth = RING_W + 2.5; c.beginPath(); c.arc(cx, cy, RING_R, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = RING_W; c.beginPath(); c.arc(cx, cy, RING_R, 0, Math.PI * 2); c.stroke();
    frames.track = [x, row];
    const x2 = x + RC, cx2 = x2 + RC / 2;
    const g = c.createRadialGradient(cx2, cy, 2, cx2, cy, RING_R + 3);
    g.addColorStop(0, 'rgba(18,24,22,0.92)'); g.addColorStop(0.8, 'rgba(10,14,13,0.86)'); g.addColorStop(1, 'rgba(10,14,13,0)');
    c.fillStyle = g; c.beginPath(); c.arc(cx2, cy, RING_R + 3, 0, Math.PI * 2); c.fill();
    frames.downDisc = [x2, row];
  }
  // row B: enemy discs (element colour only)
  RING_KEYS.forEach((el, i) => {
    const x = i * RC, cx = x + RC / 2, cy = row + RC + RC / 2;
    c.fillStyle = ELEMENT_RING[el].disc; c.beginPath(); c.arc(cx, cy, DISC_R, 0, Math.PI * 2); c.fill();
    discRim(c, cx, cy);
    frames['e:' + el] = [x, row + RC];
  });
  const base = P.BaseTexture.from(canvas, { mipmap: P.MIPMAP_MODES.ON });
  const tex = ([x, y]) => new P.Texture(base, new P.Rectangle(x, y, RC, RC));
  _rings = {
    base, canvas, size: RC,
    arcs: frames.arcs.map(tex),
    track: tex(frames.track),
    downDisc: tex(frames.downDisc),
    disc: Object.fromEntries(RING_KEYS.map((el) => [el, tex(frames['a:' + el])])),
    discEnemy: Object.fromEntries(RING_KEYS.map((el) => [el, tex(frames['e:' + el])])),
  };
  return _rings;
}

/** Arc frame of a fraction 0..1 (rounded to the nearest step; a non-zero fraction never shows an empty ring). */
export function ringArc(frac) {
  const r = hudRings();
  const f = frac > 1 ? 1 : frac > 0 ? frac : 0;
  let k = Math.round(f * RING_STEPS);
  if (k === 0 && f > 0) k = 1;
  return r.arcs[k];
}
