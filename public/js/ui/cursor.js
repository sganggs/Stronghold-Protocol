// One non-interactive, DPR-aware canvas. Animation never replaces a native cursor image.
import { data, localAsset } from '../data.js';

// Calibrated from equal-resolution official/local screenshots (110x127 vs 122x142).
const VISUAL_SCALE = 0.9;
// A single stable, transparent native image distinguishes our hand regions from explicit
// cursor:none. Both theme variables use exactly the same value, including the fallback.
const BLANK_MARKER = 'sp-hand-blank';
const BLANK = 'url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%20id%3D%22sp-hand-blank%22%2F%3E") 0 0, none';
const NATIVE_HOSTS = new Set(['CANVAS', 'VIDEO', 'IFRAME', 'IMG', 'INPUT']);

let enabled = false, generation = 0, source = null, active = null, owner = null, detach = null;
let canvas = null, context = null, geometry = null, lastFrame = -1, lastPosition = '';
let contextLost = false;
let point = null, mousePresent = false, dragging = false, nativeHidden = false;
let pose = 0, transition = null, raf = null;

function native(hide) {
  const style = owner?.doc.documentElement?.style;
  if (!style || nativeHidden === hide) return;
  nativeHidden = hide;
  for (const name of ['default', 'pointer']) {
    if (hide) style.setProperty(`--sp-cursor-${name}`, BLANK);
    else style.removeProperty(`--sp-cursor-${name}`);
  }
}
function hide() {
  if (canvas) {
    canvas.hidden = true;
    try {
      if (canvas.matches?.(':popover-open')) canvas.hidePopover?.();
    } catch { /* Older browsers can lack the popover selector as well as its API. */ }
  }
  native(false);
}
function stopAnimation() {
  if (raf != null) globalThis.cancelAnimationFrame?.(raf);
  raf = transition = null;
  pose = 0;
}
function suspend() {
  mousePresent = false; point = null;
  stopAnimation(); hide();
}
function removeCanvas() {
  hide(); canvas?.remove();
  canvas = context = geometry = null; lastFrame = -1; lastPosition = ''; contextLost = false;
}
function host() {
  const doc = owner?.doc, fullscreen = doc?.fullscreenElement || doc?.webkitFullscreenElement;
  // Fullscreen replaced elements cannot display a DOM child. Leave the native cursor usable.
  if (fullscreen && NATIVE_HOSTS.has(fullscreen.tagName)) return null;
  return fullscreen || doc?.documentElement;
}
function ensureCanvas() {
  const parent = host();
  if (!parent) return false;
  if (!canvas) {
    const element = owner.doc.createElement('canvas');
    const ctx = element.getContext('2d');
    if (!ctx) { active = null; return false; }
    element.className = 'sp-cursor-canvas';
    element.setAttribute('aria-hidden', 'true'); element.setAttribute('inert', '');
    element.hidden = true;
    element.style.cssText = 'position:fixed;inset:auto;left:0;top:0;margin:0;padding:0;border:0;'
      + 'background:transparent;pointer-events:none;user-select:none;z-index:2147483647;'
      + 'contain:strict;will-change:transform;';
    if (typeof element.showPopover === 'function') element.setAttribute('popover', 'manual');
    canvas = element; context = ctx;
    element.addEventListener('contextlost', () => { contextLost = true; geometry = null; hide(); });
    element.addEventListener('contextrestored', () => {
      contextLost = false; context = element.getContext('2d'); geometry = null; lastFrame = -1; schedule();
    });
  }
  if (canvas.parentNode !== parent) {
    hide(); parent.appendChild(canvas);
  }
  return true;
}
function size() {
  const { w, h, meta } = active;
  const scale = meta.extractVersion === 2
    ? Math.min(meta.defaultScale * VISUAL_SCALE * (owner.win.innerWidth || meta.referenceWidth) / meta.referenceWidth, 128 / Math.max(w, h)) : 1;
  const density = Math.max(1, Math.min(4, owner.win.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
  if (geometry?.width === width && geometry.height === height && geometry.density === density) return;
  canvas.width = Math.max(1, Math.round(width * density));
  canvas.height = Math.max(1, Math.round(height * density));
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  geometry = { width, height, density,
    x: Math.max(0, Math.min(width - 1, Math.round((meta.hotspot?.[0] ?? 3) * scale))),
    y: Math.max(0, Math.min(height - 1, Math.round((meta.hotspot?.[1] ?? 2) * scale))) };
  lastFrame = -1; lastPosition = '';
}
function handRegion(target) {
  if (!target || target.isConnected === false) return false;
  const cursor = owner.win.getComputedStyle(target).cursor;
  if (cursor.includes(BLANK_MARKER)) return true;
  if (!['auto', 'default', 'pointer'].includes(cursor)) return false;
  // Only take over a region whose theme cursor can actually be hidden. An explicit
  // native cursor outside the theme (including third-party widgets) must not double up.
  native(true);
  const replaced = owner.win.getComputedStyle(target).cursor.includes(BLANK_MARKER);
  if (!replaced) native(false);
  return replaced;
}
function draw() {
  if (!enabled || !active || !point || !mousePresent || dragging || contextLost || owner.doc.hidden || owner.doc.pointerLockElement
      || point.x < 0 || point.y < 0 || point.x >= owner.win.innerWidth || point.y >= owner.win.innerHeight) {
    hide(); return;
  }
  const target = owner.doc.elementFromPoint?.(point.x, point.y) || point.target;
  if (!ensureCanvas() || !context) { hide(); return; }
  if (!handRegion(target)) { hide(); return; }
  size();
  const frame = Math.round(pose * (active.count - 1));
  if (lastFrame !== frame) {
    // One draw at backing-store resolution; no PNG encode/decode or native cursor swap.
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(active.image, frame * active.w, 0, active.w, active.h, 0, 0, canvas.width, canvas.height);
    lastFrame = frame;
    canvas.dataset.pose = String(frame);
  }
  const { density, x, y } = geometry;
  const position = `translate3d(${Math.round((point.x - x) * density) / density}px, ${Math.round((point.y - y) * density) / density}px, 0)`;
  if (lastPosition !== position) { canvas.style.transform = position; lastPosition = position; }
  if (canvas.hidden || (canvas.hasAttribute?.('popover') && !canvas.matches(':popover-open'))) {
    canvas.hidden = false;
    // The top layer avoids clipping by page transforms and keeps the hand above modals.
    try { canvas.showPopover?.(); } catch {
      canvas.removeAttribute('popover'); // Fall back to fixed positioning, not a closed popover.
    }
  }
  native(true);
}
function advance(now) {
  if (!transition) return;
  const t = Math.min(1, Math.max(0, (now - transition.start) / transition.duration));
  pose = transition.from + (transition.to - transition.from) * t * t * (3 - 2 * t);
  if (t === 1) transition = null;
}
function tick(now) {
  raf = null;
  advance(now);
  try { draw(); } catch {
    // A lost rendering context or unexpected DOM state must never hide the system cursor.
    active = null; transition = null; removeCanvas();
  }
  if (transition) schedule();
}
function schedule() {
  if (!enabled || raf != null) return;
  if (globalThis.requestAnimationFrame) raf = globalThis.requestAnimationFrame(tick);
  else tick(globalThis.performance?.now() ?? Date.now());
}
function animate(to) {
  if (!active || active.count < 2 || transition?.to === to) return;
  const now = globalThis.performance?.now() ?? Date.now();
  advance(now); transition = null;
  if (owner.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !globalThis.requestAnimationFrame) pose = to;
  else if (pose !== to) transition = { from: pose, to, start: now, duration: to ? active.meta.pressMs : active.meta.releaseMs };
  schedule();
}
function mouse(event) {
  if (event.pointerType !== 'mouse') { suspend(); return false; }
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
  mousePresent = true;
  point = { x: event.clientX, y: event.clientY,
    target: event.composedPath?.().find(node => node?.nodeType === 1) || event.target };
  // Repair a mouse-up that happened outside the document without restarting a release.
  if (!(event.buttons & 1) && (pose || transition?.to === 1)) animate(0);
  schedule(); return true;
}
function bind() {
  if (detach || !globalThis.document?.addEventListener) return;
  const doc = globalThis.document, win = doc.defaultView || globalThis;
  owner = { doc, win };
  const off = [];
  const on = (target, name, listener) => {
    target.addEventListener(name, listener, { capture: true, passive: true });
    off.push(() => target.removeEventListener(name, listener, true));
  };
  on(doc, 'pointermove', mouse);
  on(doc, 'pointerover', mouse);
  on(doc, 'pointerdown', e => { if (mouse(e) && e.button === 0) animate(1); });
  on(doc, 'pointerup', e => { if (mouse(e) && e.button === 0) animate(0); });
  on(doc, 'pointerout', e => {
    // Removing a clicked DOM node can produce relatedTarget:null inside the viewport.
    // Do not mistake it for leaving the window and flash the native cursor on every click.
    if (!e.relatedTarget && (e.target === doc.documentElement || e.clientX < 0 || e.clientY < 0
        || e.clientX >= win.innerWidth || e.clientY >= win.innerHeight)) suspend();
    else schedule();
  });
  on(doc, 'pointerleave', e => { if (e.target === doc.documentElement || e.target === doc) suspend(); });
  on(doc, 'pointercancel', suspend);
  on(doc, 'visibilitychange', () => { if (doc.hidden) suspend(); else schedule(); });
  on(doc, 'pointerlockchange', suspend);
  on(doc, 'dragstart', () => { dragging = true; suspend(); });
  on(doc, 'dragend', () => { dragging = false; suspend(); });
  on(doc, 'contextmenu', suspend);
  on(doc, 'scroll', schedule);
  on(doc, 'fullscreenchange', () => { hide(); schedule(); });
  on(doc, 'webkitfullscreenchange', () => { hide(); schedule(); });
  on(win, 'blur', suspend);
  on(win, 'resize', schedule);
  let resolutionQuery;
  const watchResolution = () => {
    resolutionQuery?.removeEventListener?.('change', resolutionChanged);
    resolutionQuery = win.matchMedia?.(`(resolution: ${win.devicePixelRatio || 1}dppx)`);
    resolutionQuery?.addEventListener?.('change', resolutionChanged, { once: true });
  };
  const resolutionChanged = () => { watchResolution(); schedule(); };
  watchResolution();
  detach = () => {
    resolutionQuery?.removeEventListener?.('change', resolutionChanged);
    for (const remove of off) remove(); detach = null;
  };
}
function refresh() {
  const url = enabled ? localAsset('ui/cursor', 'prts_hand') : null;
  const meta = data.get('local')?.groups?.['ui/cursor']?.prts_hand || {};
  const key = url ? JSON.stringify([url, meta]) : null;
  if (url && source === key) return;
  const request = ++generation, session = owner;
  source = key; active = null; stopAnimation(); hide();
  if (!url || !session || !globalThis.Image) { removeCanvas(); return; }
  if (meta.extractVersion != null && ![1, 2].includes(meta.extractVersion)) return;
  if (meta.extractVersion === 2 && (![
    meta.frameWidth, meta.frameHeight, meta.frames, meta.referenceWidth, meta.defaultScale, meta.pressMs, meta.releaseMs,
  ].every(v => Number.isFinite(v) && v > 0) || !Number.isInteger(meta.frames) || meta.frames < 2 || meta.frames > 32
      || meta.frameWidth * meta.frames > 8192 || meta.frameHeight > 512)) return;
  if (meta.hotspot != null && (!Array.isArray(meta.hotspot) || meta.hotspot.length !== 2 || !meta.hotspot.every(Number.isFinite))) return;
  const image = new globalThis.Image();
  image.crossOrigin = 'anonymous'; image.decoding = 'async';
  image.onload = async () => {
    try {
      if (image.decode) await image.decode();
      if (!enabled || request !== generation || session !== owner) return;
      const w = meta.extractVersion === 2 ? meta.frameWidth : image.naturalWidth;
      const h = meta.extractVersion === 2 ? meta.frameHeight : image.naturalHeight;
      const count = meta.extractVersion === 2 ? meta.frames : 1;
      if (!w || !h || w > 512 || h > 512 || image.naturalWidth !== w * count || image.naturalHeight !== h) return;
      active = { image, w, h, count, meta };
      geometry = null; lastFrame = -1; schedule();
    } catch { /* The system cursor stays active on decode failure. */ }
  };
  image.onerror = () => { /* Leave the system cursor active; do not retry in the input path. */ };
  image.src = url;
}

export function applyCursor(value) {
  enabled = value === true;
  if (enabled) bind();
  else {
    generation++; source = null; active = null;
    suspend(); detach?.(); removeCanvas(); owner = null; dragging = false;
  }
  refresh();
  if (enabled) data.load('local').catch(() => {});
}

data.subscribe(name => { if (name === 'local') refresh(); });
