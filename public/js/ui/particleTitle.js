// ui/particleTitle.js — the title screen's particle logo (canvas 2D, no dependencies).
//
// Idea from Arknights logo particle animations (github.com/XIwE1/ark-particle-animation): rasterise
// the logo to pixels, let every sampled pixel become a particle, stream the particles onto the glyphs
// and push them aside with the pointer (they spring back). Here the "logo" is the original dot-matrix
// emblem (the upstream 13×14 watchtower — brackets included) and the two English title lines, drawn
// with the same geometry / fonts / sizes as css/screens/title.css: no image asset, so nothing can
// 404 and the logo stays sharp on every screen. Every emblem dot is rendered as a small particle
// cluster whose bounding circle is EXACTLY the dot's original SVG size (1:1 — cluster centres stay
// within R − size/2, so the rendered dot can never grow past its circle). The emblem pings outward
// from its centre, the English lines stream in from the left (the Chinese title stays a plain DOM
// heading — crisper at reading size, and it is the screen's real <h1>). The DOM emblem / English
// lines stay in the page for screen readers and as the no-canvas / reduced-motion fallback;
// screens/title.js crossfades to the canvas once its first frame is up.
//
// Pure helpers (layoutTitle / drawTitleText / emblemDots / emblemBox / emblemParticles / emblemRow /
// planStep / collectTargets) are unit-tested in test/ui/particleTitle.test.js; createParticleTitle is
// the only DOM entry.

const FONT_DISPLAY = "'Novecento', 'Novecento Wide', 'Oxanium', 'Rajdhani', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const FONT_CJK = "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif";

const ALPHA_MIN = 51;          // coverage a rasterised pixel needs to become a particle (0.2 × 255)
const DPR_MAX = 2;             // backing-store scale cap (a 3× phone does not need 9× the particles)
const SPRING = 30;             // glyph spring (1/s²)
const DAMP = 7.5;              // spring damping (1/s)
const CURSOR_RADIUS = 86;      // pointer repulsion radius, CSS px
const CURSOR_PUSH = 2400;      // repulsion acceleration at the centre, px/s²
const TAP_RADIUS = 170;        // press ripple radius, CSS px
const TAP_PUSH = 700;          // instant velocity a press adds at the ripple centre, px/s
const ENTRANCE_MS = 780;       // how long the left-to-right reveal takes
const TWINKLE = 0.16;          // idle alpha modulation
const SPARK_RATE = 0.015;      // fraction of particles rendered as gold telemetry blips

/** Empty canvas above/below the logo block, in rem (room for the scatter; screens/title.css sizes the canvas with the same figure). */
export const TITLE_PAD = 0.25;

// The two English title lines (rasterised to particles). Sizes / gaps / colours mirror
// css/screens/title.css (.title-en, .title-en__b) — keep the two in sync. The Chinese title is
// deliberately NOT here: it stays a plain DOM heading.
export const TITLE_LINES = [
  { parts: [['STRONGHOLD PROTOCOL', '#cdd6d1']], font: 'display', weight: 500, size: 0.34, tracking: 0.30, lineHeight: 1, gapBefore: 0 },
  { parts: [['ALLIANCE', '#4ed8af']], font: 'display', weight: 700, size: 0.38, tracking: 0.34, lineHeight: 1, gapBefore: 0.02 },
];

/** Emblem row height (its bracket frame), the gap to the title text and the bracket width, in rem — mirror title.css. */
export const EMBLEM_ROW = 1.7;
export const EMBLEM_GAP = 0.26;
export const EMBLEM_BRACKET = 0.16;

const EMBLEM_SVG_W = 1.3; // .emblem__svg width in rem
const EMBLEM_SVG_H = 1.4; // .emblem__svg height in rem

// The original dot-matrix watchtower (13×14 bitmap; dots grow toward the base). One source for the
// DOM SVG in screens/title.js and for the particle clusters here.
export const EMBLEM = [
  'XXX..XXX..XXX',
  'XXX..XXX..XXX',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXX.XXXX..',
  '..XXXX.XXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '.XXXXXXXXXXX.',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
];

/** Emblem dots in SVG user units (viewBox -0.5 -0.5 14 15): centre, radius, accent dot, twinkle phase. */
export function emblemDots() {
  const out = [];
  EMBLEM.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== 'X') return;
      out.push({
        cx: x + 0.5,
        cy: y + 0.5,
        r: 0.2 + (y / (EMBLEM.length - 1)) * 0.2,
        accent: (y === 6 || y === 7) && (x === 5 || x === 7),
        d: (y * 13 + x) % 7,
      });
    });
  });
  return out;
}

/** Where the emblem's 1.3rem × 1.4rem SVG box sits on the canvas (centred in its bracket row). */
export function emblemBox(width, remPx) {
  const boxW = EMBLEM_SVG_W * remPx;
  const boxH = EMBLEM_SVG_H * remPx;
  const row = emblemRow(width, remPx);
  return { boxW, boxH, left: (width - boxW) / 2, top: row.top + (row.height - boxH) / 2, scale: boxW / 14 };
}

/**
 * Every emblem dot as a particle cluster, in CSS px. The cluster is confined to the dot's original
 * circle (centres within R − size/2), so the rendered dot — bounding box included — is a 1:1 copy of
 * the SVG circle it replaces; a dot too small for a cluster renders as one particle of exactly its
 * diameter. `rand` is injectable for deterministic tests.
 * @returns {{x:number,y:number,size:number,r:number,g:number,b:number,a:number,emblem:true,accent:boolean}[]}
 */
export function emblemParticles(remPx, width, rand = Math.random) {
  const box = emblemBox(width, remPx);
  const out = [];
  for (const dot of emblemDots()) {
    const R = dot.r * box.scale; // CSS px radius — the original size, unchanged
    const cx = box.left + (dot.cx + 0.5) * box.scale;
    const cy = box.top + (dot.cy + 0.5) * box.scale;
    const r = dot.accent ? 23 : 223;   // var(--mint-glow) / the SVG's #dfe6e2
    const g = dot.accent ? 249 : 230;
    const b = dot.accent ? 183 : 226;
    const size = Math.min(1.9, R * 1.8); // particle diameter (never wider than the dot)
    if (R - size / 2 < 0.35) {
      // no room for a cluster — one particle IS the dot, exactly its diameter
      out.push({ x: cx, y: cy, size: R * 2, r, g, b, a: 1, emblem: true, accent: dot.accent });
      continue;
    }
    const count = Math.max(1, Math.ceil((R / 0.55) ** 2));
    const disc = R - size / 2;
    for (let i = 0; i < count; i++) {
      const rr = disc * Math.sqrt(rand());
      const th = rand() * Math.PI * 2;
      out.push({
        x: cx + Math.cos(th) * rr,
        y: cy + Math.sin(th) * rr,
        size, r, g, b, a: 0.95 + rand() * 0.05,
        emblem: true,
        accent: dot.accent,
      });
    }
  }
  return out;
}

/** The emblem's bracket row: both 2px [ ] frames plus the dot box between them, centred on the canvas. */
export function emblemRow(width, remPx) {
  const rowW = (2 * EMBLEM_BRACKET + 2 * EMBLEM_GAP + EMBLEM_SVG_W) * remPx;
  return {
    rowW,
    left: (width - rowW) / 2,
    top: TITLE_PAD * remPx,
    height: EMBLEM_ROW * remPx,
    bracketW: EMBLEM_BRACKET * remPx,
  };
}

/**
 * Vertical layout of the title lines for one root font size. `cy` is the line centre measured from
 * the top of the text block, which is drawn under the emblem (TITLE_PAD + EMBLEM_ROW + EMBLEM_GAP).
 * @param {number} remPx root font size in CSS px (HTML { font-size })
 */
export function layoutTitle(remPx) {
  const lines = [];
  let top = 0;
  for (const line of TITLE_LINES) {
    top += (line.gapBefore || 0) * remPx;
    const sizePx = line.size * remPx;
    const box = sizePx * line.lineHeight;
    lines.push({
      parts: line.parts,
      sizePx,
      trackingPx: line.tracking * sizePx,
      fontSpec: `${line.weight} ${sizePx}px ${line.font === 'cjk' ? FONT_CJK : FONT_DISPLAY}`,
      cy: top + box / 2,
    });
    top += box;
  }
  return { lines, textHeight: top, height: top + 2 * TITLE_PAD * remPx };
}

/**
 * Draw the title lines centred horizontally at `width`; `top` is the pixel row the text block starts
 * at (ctx is already scaled to CSS px). Per-character drawing, because CJK letter-spacing must not
 * depend on ctx.letterSpacing (Firefox < 121 has none) and the trailing spacing is excluded from the
 * centring — the same optical compensation the CSS does with padding-left.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawTitleText(ctx, lines, width, top) {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const line of lines) {
    ctx.font = line.fontSpec;
    let total = 0;
    for (const [text] of line.parts) {
      for (const ch of text) total += ctx.measureText(ch).width + line.trackingPx;
    }
    if (total > 0) total -= line.trackingPx;
    let x = (width - total) / 2;
    const y = top + line.cy;
    for (const [text, color] of line.parts) {
      ctx.fillStyle = color;
      for (const ch of text) {
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width + line.trackingPx;
      }
    }
  }
}

/**
 * Sampling step (in image pixels) that keeps the particle count under `maxParticles`.
 * Counts covered pixels at full resolution once, then picks the grid step.
 * @param {Uint8ClampedArray} data RGBA
 */
export function planStep(data, width, height, maxParticles) {
  let hits = 0;
  const px = width * height;
  for (let i = 0; i < px; i++) if (data[i * 4 + 3] >= ALPHA_MIN) hits++;
  let step = 2;
  while (hits / (step * step) > maxParticles && step < 12) step++;
  return step;
}

/**
 * Sample covered pixels into particle targets. Coordinates are divided by `scale` (the device-pixel
 * ratio the image was rasterised at), so the result is in CSS px.
 * @param {Uint8ClampedArray} data RGBA
 * @returns {{x:number,y:number,r:number,g:number,b:number,a:number}[]}
 */
export function collectTargets(data, width, height, step, scale = 1) {
  const out = [];
  const half = step / 2;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < ALPHA_MIN) continue;
      out.push({ x: (x + half) / scale, y: (y + half) / scale, r: data[i], g: data[i + 1], b: data[i + 2], a: a / 255 });
    }
  }
  return out;
}

/** The sampled pixel colour, lightly jittered; the gold "telemetry" blips sparkle instead. */
function particleColor(t, spark, emblem) {
  const jitter = spark ? 1 : emblem ? 0.94 + Math.random() * 0.1 : 0.86 + Math.random() * 0.28;
  const r = spark ? 255 : Math.min(255, Math.round(t.r * jitter));
  const g = spark ? 214 : Math.min(255, Math.round(t.g * jitter));
  const b = spark ? 120 : Math.min(255, Math.round(t.b * jitter));
  return `rgb(${r},${g},${b})`;
}

/** One rasterised pixel: a dot that springs to its glyph position and flees the pointer. */
export class Particle {
  /**
   * @param {{x:number,y:number,r:number,g:number,b:number,a:number,emblem?:boolean}} t target
   * @param {{x:number,y:number,delay:number}|null} spawn where it waits before joining (null = on target)
   */
  constructor(t, spawn) {
    // Colour: the sampled pixel, lightly jittered; a few gold "telemetry" blips sparkle instead.
    this.emblem = !!t.emblem;
    this.accent = !!t.accent;
    this.spark = !this.emblem && Math.random() < SPARK_RATE;
    this.css = particleColor(t, this.spark, this.emblem);
    this.tx = t.x;
    this.ty = t.y;
    this.a0 = 0.45 + 0.55 * t.a;
    // emblem dots keep their exact size (emblemParticles supplies it); glyph pixels size from coverage
    this.size = t.size != null ? t.size : 1.4 + 0.8 * t.a;
    this.phase = Math.random() * Math.PI * 2;
    this.spd = 0.6 + Math.random();
    this.vx = 0;
    this.vy = 0;
    this.alpha = 0;
    this.x = spawn ? spawn.x : t.x;
    this.y = spawn ? spawn.y : t.y;
    this.delay = spawn ? spawn.delay : 0;
  }

  /**
   * A resize / zoom re-points a settled particle at the new raster: position, alpha, size and colour
   * follow (the rebuild used to retarget the position only, so the logo kept its old dot sizes and
   * sampled colours — the review of this PR), and its emblem / accent identity travels with the new
   * target in case the text/emblem split shifted.
   */
  retarget(t) {
    this.tx = t.x;
    this.ty = t.y;
    this.a0 = 0.45 + 0.55 * t.a;
    this.size = t.size != null ? t.size : 1.4 + 0.8 * t.a;
    this.emblem = !!t.emblem;
    this.accent = !!t.accent;
    if (this.emblem) this.spark = false;
    this.css = particleColor(t, this.spark, this.emblem);
  }
}

/** Where a particle waits before it joins the logo: the emblem pings out of its centre, the text streams in from the left. */
function spawnFor(t, cssW, emblem) {
  if (t.emblem) {
    const dist = Math.hypot(t.x - emblem.x, t.y - emblem.y);
    return {
      x: emblem.x + (Math.random() - 0.5) * 16,
      y: emblem.y + (Math.random() - 0.5) * 16,
      delay: (dist / emblem.maxDist) * 380 + Math.random() * 120,
    };
  }
  return {
    x: t.x - 50 - Math.random() * 190,
    y: t.y + (Math.random() - 0.5) * 96,
    delay: 120 + (t.x / Math.max(1, cssW)) * ENTRANCE_MS + Math.random() * 140,
  };
}

/**
 * Mount the particle logo on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {{still?:boolean, maxParticles?:number, onReady?:() => void, fontWaitMs?:number}} [opts]
 *   still: one static frame (default: from prefers-reduced-motion); onReady: the first frame is up.
 * @returns {{burst:() => void, destroy:() => void} | null} null when 2D canvas is unavailable
 */
export function createParticleTitle(canvas, opts = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const media = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : null);
  const still = opts.still ?? !!media('(prefers-reduced-motion: reduce)')?.matches;
  const coarse = !!media('(pointer: coarse)')?.matches;
  const maxParticles = opts.maxParticles ?? (coarse ? 2600 : 4600);

  let alive = true;
  let started = false;
  let startAt = 0;
  let cssW = 0;
  let cssH = 0;
  let burstAt = 0;
  let pointer = null;
  let raf = 0;
  let lastTs = 0;
  let rebuildQueued = false;
  /** @type {Particle[]} */
  let particles = [];

  const listenEl = (canvas.closest && canvas.closest('.title-screen')) || canvas.parentElement || canvas;

  /** Rasterise the bracket frames + English title lines (the emblem dots are NOT sampled — emblemParticles() supplies them at exact size); returns pixels + geometry. */
  function rasterise(dpr) {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(cssW * dpr));
    off.height = Math.max(1, Math.round(cssH * dpr));
    const octx = off.getContext('2d');
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // the [ ] frames, as the CSS draws them: 2px three-sided outlines
    const row = emblemRow(cssW, remPx);
    octx.strokeStyle = 'rgba(223, 230, 226, .45)';
    octx.lineWidth = 2;
    for (const side of [-1, 1]) {
      const x = side < 0 ? row.left + 1 : row.left + row.rowW - row.bracketW + 1;
      const w = row.bracketW - 2;
      const y = row.top + 1;
      const h = row.height - 2;
      octx.beginPath();
      if (side < 0) {
        octx.moveTo(x + w, y); octx.lineTo(x, y); octx.lineTo(x, y + h); octx.lineTo(x + w, y + h);
      } else {
        octx.moveTo(x, y); octx.lineTo(x + w, y); octx.lineTo(x + w, y + h); octx.lineTo(x, y + h);
      }
      octx.stroke();
    }
    const box = emblemBox(cssW, remPx);
    const ex = box.left + box.boxW / 2;
    const ey = box.top + box.boxH / 2;
    const layout = layoutTitle(remPx);
    drawTitleText(octx, layout.lines, cssW, (TITLE_PAD + EMBLEM_ROW + EMBLEM_GAP) * remPx);
    return {
      data: octx.getImageData(0, 0, off.width, off.height).data,
      w: off.width,
      h: off.height,
      remPx,
      // anything above the gap is the emblem (used for the ping-out entrance)
      emblemBottom: (TITLE_PAD + EMBLEM_ROW) * remPx,
      emblem: { x: ex, y: ey, maxDist: Math.hypot(box.boxW / 2, box.boxH / 2) },
    };
  }

  /** Build (first time) or rebuild (resize) the particle set for the current canvas size. */
  function build() {
    if (!alive) return;
    const rect = canvas.getBoundingClientRect();
    cssW = Math.round(rect.width);
    cssH = Math.round(rect.height);
    if (cssW < 24 || cssH < 24) return; // laid out but not measurable yet — the next resize retries
    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const raster = rasterise(dpr);
    const step = planStep(raster.data, raster.w, raster.h, maxParticles);
    const targets = collectTargets(raster.data, raster.w, raster.h, step, dpr);
    for (const t of targets) t.emblem = t.y < raster.emblemBottom;
    // the emblem dots join as exact-size particle clusters (never sampled — 1:1 sizes)
    targets.push(...emblemParticles(raster.remPx, cssW));

    if (!started) {
      started = true;
      particles = targets.map((t) => new Particle(t, still ? null : spawnFor(t, cssW, raster.emblem)));
      startAt = performance.now();
      opts.onReady?.();
    } else {
      // Resize: retarget in place (a settled set must not replay the entrance).
      const keep = Math.min(particles.length, targets.length);
      for (let i = 0; i < keep; i++) particles[i].retarget(targets[i]);
      for (let i = keep; i < targets.length; i++) particles.push(new Particle(targets[i], null));
      if (particles.length > targets.length) particles.length = targets.length;
    }
    if (still) drawFrame(startAt + 1);
    else {
      drawFrame(performance.now());
      if (!raf) {
        lastTs = performance.now();
        raf = requestAnimationFrame(loop);
      }
    }
  }

  function scheduleRebuild() {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => { rebuildQueued = false; build(); });
  }

  /** Spring + pointer repulsion + idle jitter for one frame. */
  function stepPhysics(ts, dt) {
    const R2 = CURSOR_RADIUS * CURSOR_RADIUS;
    for (const p of particles) {
      const age = ts - (startAt + p.delay);
      if (age < 0) continue;
      if (pointer) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 0.001;
          const f = 1 - d / CURSOR_RADIUS;
          const acc = CURSOR_PUSH * f * f * dt;
          p.vx += (dx / d) * acc;
          p.vy += (dy / d) * acc;
        }
      }
      const jx = Math.sin(ts * 0.0006 * p.spd + p.phase) * 0.45;
      const jy = Math.cos(ts * 0.0008 * p.spd + p.phase * 1.7) * 0.45;
      p.vx += ((p.tx + jx - p.x) * SPRING - p.vx * DAMP) * dt;
      p.vy += ((p.ty + jy - p.y) * SPRING - p.vy * DAMP) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /** Draw every particle at its current alpha (ids in CSS px; the ctx is scaled to CSS px). */
  function drawFrame(ts) {
    ctx.clearRect(0, 0, cssW, cssH);
    const burstFade = burstAt ? Math.max(0, 1 - (ts - burstAt) / 360) : 1;
    if (burstFade === 0) return;
    for (const p of particles) {
      const age = ts - (startAt + p.delay);
      if (age < 0) continue;
      const appear = still ? 1 : Math.min(1, age / 180);
      // emblem dots twinkle like the SVG's dot-twinkle (0.55–1); the accents stay steady (their SVG
      // circles have no animation); the title keeps a gentler shimmer
      const mid = p.emblem ? (p.accent ? 0.97 : 0.76) : 0.84;
      const amp = p.emblem ? (p.accent ? 0.03 : 0.24) : TWINKLE;
      const tw = p.spark
        ? 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(ts * 0.006 * p.spd + p.phase), 3)
        : mid + amp * Math.sin(ts * 0.0015 * p.spd + p.phase);
      p.alpha = p.a0 * appear * tw * burstFade;
      if (p.alpha <= 0.02) continue;
      ctx.globalAlpha = Math.min(1, p.alpha);
      ctx.fillStyle = p.css;
      if (p.emblem) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  function loop(ts) {
    if (!alive || still) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.033, Math.max(0.001, (ts - lastTs) / 1000 || 0.016));
    lastTs = ts;
    stepPhysics(ts, dt);
    drawFrame(ts);
  }

  /** Push particles away from a point (an instant, dissipating kick). */
  function ripple(cx, cy, radius, push) {
    for (const p of particles) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d >= radius) continue;
      const f = 1 - d / radius;
      const s = push * f * f;
      p.vx += (dx / d) * s;
      p.vy += (dy / d) * s;
    }
  }

  const toLocal = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const onMove = (ev) => { pointer = toLocal(ev); };
  const onLeave = () => { pointer = null; };
  const onDown = (ev) => {
    const el = ev.target;
    // a press on the login console (input, buttons) is UI, not a ripple
    if (el && typeof el.closest === 'function' && el.closest('button, a, input, select, textarea, [role="button"], .title-login')) return;
    const pt = toLocal(ev);
    ripple(pt.x, pt.y, TAP_RADIUS, TAP_PUSH);
  };
  listenEl.addEventListener('pointermove', onMove, { passive: true });
  listenEl.addEventListener('pointerleave', onLeave, { passive: true });
  listenEl.addEventListener('pointercancel', onLeave, { passive: true });
  listenEl.addEventListener('pointerdown', onDown, { passive: true });

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRebuild) : null;
  ro?.observe(canvas);
  window.addEventListener('resize', scheduleRebuild);

  // Fonts decide the glyphs: wait for them, but never longer than a beat (offline / blocked webfonts).
  const fonts = typeof document !== 'undefined' && document.fonts ? document.fonts.ready : null;
  Promise.race([fonts || Promise.resolve(), new Promise((res) => setTimeout(res, opts.fontWaitMs ?? 700))])
    .then(() => { if (alive) build(); });

  return {
    /** Blow the glyphs apart (the 开始 exit beat). */
    burst() {
      if (!alive || !particles.length) return;
      burstAt = performance.now();
      const cx = cssW / 2;
      const cy = cssH / 2;
      for (const p of particles) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.hypot(dx, dy) || 0.001;
        const s = 320 + Math.random() * 460;
        p.vx += (dx / d) * s + (Math.random() - 0.5) * 60;
        p.vy += (dy / d) * s + (Math.random() - 0.5) * 60;
      }
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      raf = 0;
      ro?.disconnect();
      window.removeEventListener('resize', scheduleRebuild);
      listenEl.removeEventListener('pointermove', onMove);
      listenEl.removeEventListener('pointerleave', onLeave);
      listenEl.removeEventListener('pointercancel', onLeave);
      listenEl.removeEventListener('pointerdown', onDown);
    },
  };
}
