// 卫戍协议：盟约 entry animation and lobby scene: the event's opening (ui/entryFilm.js plays it before the title screen)
// and its lobby backdrop, a 20 s night / dusk cycle (the title screen and the lobby draw it, screens/title.js, lobby.js).
// Rebuilt frame by frame from a 30 fps recording of the official event (attached to the pull request): every track
// below (K[...]) is keyed in that video's seconds. Pictures are the event's own sprites from data/assets.json `ui`
// (entry/* and prepareBkg/*); the code only moves, scales, fades, tints and wipes them. [ASSUMED] The bars / cables /
// INPUT slab / glyph line of the transition and the lock-on box's contour rings have no sprite: flat shapes drawn to
// the recording. The Latin labels inside the film (STRONGHOLD PROTOCOL, ALLIANCE, AB1 …) are part of the official
// picture in every language; the one sentence of the lockup, 卫戍协议: 盟约, goes through t().
// Plain DOM in a 1280×720 stage; class names carry the `spa-` prefix (the film and a backdrop can be on screen
// together, so nothing here uses an element id).
import { useEffect, useRef } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { data } from '../data.js';
import { uiUrl } from './assetUrls.js';
import { reducedMotion } from './device.js';
import { t } from '../../../shared/i18n.js';

const SPRITES = {
  fog: 'entry/entry_bkg_01', ship: 'entry/entry_bkg_02', logo: 'entry/season_logo', night: 'entry/bkg_01',
  dusk: 'entry/bkg_02', ridge: 'entry/bg_mountains_tiled', scan: 'prepareBkg/img_screen_line_repeat', cross: 'prepareBkg/img_bkg_cross',
};
/** URL of one of the scenes' sprites (data/assets.json `ui`), null without the art pack. */
export function spriteUrl(name) {
  return uiUrl(data.get('assets'), SPRITES[name]) || null;
}
/** Does the art pack have every sprite of the lobby scene (`lobby`) or of the whole film? */
export function hasSprites(names = Object.keys(SPRITES)) {
  return names.every((n) => !!spriteUrl(n));
}
export const LOBBY_SPRITES = ['night', 'dusk', 'ridge', 'scan'];
/** Load and decode every sprite of the given scenes (never rejects; gives up after `ms`). */
export function preloadSprites(names = Object.keys(SPRITES), ms = 2500) {
  const all = Promise.all(names.map((n) => new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => { (im.decode ? im.decode() : Promise.resolve()).then(resolve, resolve); };
    im.onerror = resolve;
    const u = spriteUrl(n);
    if (!u) { resolve(); return; }
    im.src = u;
  })));
  return Promise.race([all, new Promise((r) => setTimeout(r, ms))]);
}

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
/** monotone cubic interpolation (Fritsch-Carlson) through measured keys: no overshoot between keys */
export function curve(keys) {
  const n = keys.length, x = keys.map((k) => k[0]), y = keys.map((k) => k[1]), d = [], m = [];
  if (n === 1) return () => y[0];
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (t) => {
    if (t <= x[0]) return y[0];
    if (t >= x[n - 1]) return y[n - 1];
    let i = 0; while (t > x[i + 1]) i++;
    const h = x[i + 1] - x[i], u = (t - x[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * y[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * y[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}
/** multi-channel track: K([[t,a,b,c],...]) -> t => [a,b,c] */
function K(rows) {
  const cs = [];
  for (let c = 1; c < rows[0].length; c++) cs.push(curve(rows.map((r) => [r[0], r[c]])));
  return (t) => cs.map((f) => f(t));
}

// ---- styles (injected once) ------------------------------------------------------------------------------------
const CSS = `
.spa-stage{position:absolute;left:50%;top:50%;width:1280px;height:720px;transform:translate(-50%,-50%);transform-origin:50% 50%;overflow:hidden;background:#000;
  font-family:Bender,"Microsoft YaHei","Noto Sans SC",sans-serif;color:#dfe9ea;line-height:normal;text-align:left;contain:layout paint}
.spa-stage *{box-sizing:border-box;margin:0;padding:0}
.spa-stage img{display:block;max-width:none;user-select:none;pointer-events:none}
.spa-L{position:absolute;inset:0}
.spa-a0{position:absolute;left:0;top:0;transform-origin:0 0}
.spa-scene{position:absolute;inset:0;overflow:hidden;will-change:opacity}
.spa-night{position:absolute;left:-146px;top:-121px;width:1577px;height:708px;filter:url(#spaNightTone)}
.spa-dusk{position:absolute;left:-384px;top:-210px;width:2048px;height:920px;filter:url(#spaDuskTone)}
.spa-ridge{position:absolute;left:0;right:0;top:309px;height:359px;background-repeat:repeat-x;background-size:1556px 359px}
.spa-ridgeN{background-position:-164px 0}
.spa-ridgeD{background-position:-74px 0;filter:brightness(.9)}
.spa-lgrid{opacity:0;filter:blur(.7px);background-image:linear-gradient(90deg,rgba(34,31,12,.9) 3px,transparent 3px),linear-gradient(180deg,rgba(34,31,12,.9) 3px,transparent 3px);
  background-size:130px 130px;background-position:114px 4px}
.spa-lockBox{position:absolute;left:375px;top:142px;width:125px;height:123px;border:2px solid #9a7638;overflow:hidden}
.spa-glow{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(255,200,90,.55),rgba(255,170,60,.12) 60%,transparent 75%)}
.spa-lockTopo{position:absolute;inset:0;width:100%;height:100%}
.spa-lockLine{position:absolute;top:203px;height:2px;background:#9a7638}
.spa-lockBk{position:absolute;top:191px;width:7px;height:24px;border:2px solid #9a7638}
.spa-lockBL{left:343px;border-right:none}.spa-lockBR{left:515px;border-left:none}
.spa-lobbyShade{background:linear-gradient(rgba(0,0,0,.6),rgba(0,0,0,.35) 90px,transparent 160px,transparent 470px,rgba(0,0,0,.8) 610px,#000 690px)}
.spa-lobbyScan{background-repeat:repeat;background-size:128px 128px;opacity:.3;mix-blend-mode:screen}
.spa-vig{background:radial-gradient(ellipse at 50% 45%,transparent 55%,rgba(0,0,0,.6) 100%)}

.spa-intro{background:#000}
.spa-cam{position:absolute;inset:0;transform-origin:606px 330px}
.spa-bgTone{position:absolute;inset:-600px;background:#000}
.spa-fog{position:absolute;left:88px;top:94px;width:1007px;height:527px}
.spa-fog2{position:absolute;left:475px;top:-60px;width:1050px;height:640px;opacity:0;mix-blend-mode:screen}
.spa-shade{position:absolute;left:-200px;top:-150px;width:1700px;height:700px;transform:rotate(-6deg);transform-origin:50% 100%;
  background:linear-gradient(rgba(9,20,26,.74) 0%,rgba(10,22,28,.58) 48%,rgba(10,22,28,.18) 75%,transparent 88%)}
.spa-ship{position:absolute;left:100px;top:97px;width:1028px}
.spa-hud{position:absolute;left:0;top:0}
.spa-hud i{position:absolute;width:3px;height:3px;background:#0e1a1e}
.spa-rowsBase{position:absolute;inset:0;background:#7a96a0}
.spa-rowsBase .spa-vg{position:absolute;inset:0;background:radial-gradient(ellipse 60% 75% at 0% 0%,rgba(4,8,10,.9),transparent 62%),linear-gradient(rgba(4,8,10,.5),transparent 20%)}
.spa-row{position:absolute;left:0;top:0;height:99px}
.spa-row .spa-box{position:absolute;left:0;top:0;width:230px;height:99px;background:#13181d;color:#2e383d;font-size:64px;line-height:99px;text-align:right;padding-right:24px}
.spa-row .spa-ear{position:absolute;left:-24px;top:21px;width:24px;height:57px;background:#13181d}
.spa-row .spa-tick{position:absolute;left:253px;top:0;width:23px;height:99px;background:#13181d}
.spa-row .spa-rslab{position:absolute;left:318px;top:0;width:4000px;height:99px;background:#13181d;
  clip-path:polygon(0 0,100% 0,100% 100%,0 100%,0 68%,24px 68%,24px 32%,0 32%)}
.spa-row .spa-cap{position:absolute;left:2px;top:126px;width:222px;height:15px;opacity:.75}
.spa-band,.spa-lline,.spa-bband,.spa-r1slab,.spa-r2bar{position:absolute;left:0;width:1280px;top:0}
.spa-band{background:#000}
.spa-lline{background:rgba(225,242,246,.3)}
.spa-bband{background:rgba(26,40,46,.25)}
.spa-r1slab,.spa-r2bar{background:#12181d}
.spa-rail{position:absolute;left:0;top:0;width:1280px;height:720px;overflow:visible}
.spa-slab{position:absolute;left:0;top:0}
.spa-slab .spa-s{position:absolute;background:#1b252c}
.spa-introScan{background-repeat:repeat;background-size:128px 128px;opacity:.8;mix-blend-mode:screen}
.spa-grain{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:overlay}
.spa-cross{position:absolute;left:0;top:0;width:58px;transform-origin:0 0}
.spa-hb{position:absolute;top:390px;height:1px;background:rgb(88,108,117)}
.spa-hbk{position:absolute;top:378px;width:9px;height:25px;border:2px solid rgb(96,116,124)}
.spa-orange{position:absolute;left:640px;top:664px;transform:translateX(-50%);font-size:11px;letter-spacing:.06em;color:#9a6436;white-space:nowrap}

.spa-logo{pointer-events:none}
.spa-card{background:#212226}
.spa-pyr{position:absolute;left:0;top:0;width:177px;height:156px;transform-origin:0 0}
.spa-pyr img{position:absolute;left:0;top:0;width:177px;height:156px}
.spa-pyrTeal{filter:brightness(.56) sepia(.2) hue-rotate(160deg) saturate(.7)}
.spa-cream{overflow:hidden;background:repeating-linear-gradient(0deg,rgba(40,36,32,.16) 0 1px,transparent 1px 3px),#dcd4ca}
.spa-pyrBlack{position:absolute;left:0;top:0;width:177px;height:156px;filter:brightness(0);transform-origin:0 0}
.spa-brk{border:2px solid rgb(150,158,162);width:12px}
.spa-bkL{border-right:none}.spa-bkR{border-left:none}
.spa-abs{display:flex;gap:6px;transform-origin:0 0}
.spa-abs span{display:block;width:42px;height:14px;background:#252e31;color:#8d9da2;font-size:11px;line-height:14px;text-align:center}
.spa-abs span:nth-child(3){margin-left:14px}
.spa-tline{white-space:nowrap;line-height:1;font-size:40px}
.spa-tB{font-weight:400;letter-spacing:.01em;-webkit-text-stroke:.9px currentColor}
.spa-tB .spa-pale{-webkit-text-stroke:0}
.spa-tB .spa-ink{color:#1d2428}
.spa-tB .spa-pale{position:absolute;left:0;top:0;background:linear-gradient(#f2f2f0 0%,#e8eaea 30%,rgba(210,214,216,.42) 52%,rgba(200,205,208,.08) 80%,rgba(200,205,208,0) 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.spa-tC{color:#47c9a9;text-shadow:0 0 6px rgba(70,200,170,.35)}
.spa-dot2{position:absolute;left:0;top:0;width:7px;height:16px;background:linear-gradient(#dfe3e2 0 6px,transparent 6px 10px,#dfe3e2 10px 16px)}
.spa-tE{font-family:"Microsoft YaHei","Noto Sans SC",sans-serif;font-weight:700;color:#f2f2ec}
.spa-tE em{font-style:normal;color:#42c7a9}
.spa-blk{display:flex;gap:6px;align-items:flex-start;transform-origin:0 0}
.spa-blk .spa-bars{display:flex;flex-direction:column;gap:3px}
.spa-blk .spa-bars i{display:block;width:50px;height:13px;background:linear-gradient(90deg,currentColor 0 30px,transparent 30px 33px,currentColor 33px)}
.spa-blk .spa-lines{font-size:9.5px;line-height:13px;letter-spacing:.03em;white-space:nowrap}
.spa-blk .spa-lines b{display:block;font-weight:400;padding:0 3px;background:currentColor}
.spa-blk .spa-lines b span{color:#05090b}
.spa-blk .spa-lines s{text-decoration:none}`;

/** The style sheet and the SVG filters (one copy for the page: the intro and the backdrop share them). */
function ensureShared() {
  if (document.getElementById('spa-style')) return;
  const st = document.createElement('style');
  st.id = 'spa-style';
  st.textContent = CSS;
  document.head.append(st);
  // lobby tones (sRGB space): night = per-channel linear fit to the video; dusk = gains that map the dunes' orange and
  // their grey shadows onto the video's (an offset would tint the dark sky blue). Boosts: the screen crosses' outline.
  const defs = document.createElement('div');
  defs.id = 'spa-defs';
  defs.setAttribute('aria-hidden', 'true');
  defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  defs.innerHTML = `<svg width="0" height="0" style="position:absolute">
    <filter id="spaNightTone" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="2.252 0 0 0 -.120  0 2.302 0 0 -.144  0 0 1.555 0 -.050  0 0 0 1 0"/></filter>
    <filter id="spaDuskTone" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".80 0 0 0 0  0 .81 0 0 0  0 0 .85 0 0  0 0 0 1 0"/></filter>
    <filter id="spaBoostDark"><feMorphology operator="dilate" radius=".8"/><feColorMatrix type="matrix" values="0 0 0 0 .05  0 0 0 0 .09  0 0 0 0 .11  0 0 0 22 0"/></filter>
    <filter id="spaBoostPale"><feMorphology operator="dilate" radius=".8"/><feColorMatrix type="matrix" values="0 0 0 0 .36  0 0 0 0 .41  0 0 0 0 .43  0 0 0 18 0"/></filter></svg>`;
  document.body.append(defs);
}

/** Every element with data-k, by name (repeated names collect into an array). */
function refs(root) {
  const E = {};
  root.querySelectorAll('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    if (E[k]) E[k] = [].concat(E[k], el); else E[k] = el;
  });
  return E;
}
const show = (el, on) => { el.style.display = on ? '' : 'none'; };
const place = (el, x, y, w, h) => { el.style.transform = `translate(${x}px,${y}px)`; el.style.width = w + 'px'; el.style.height = h + 'px'; };

// ======================= the lobby: a 20 s night / dusk cycle =======================
/* Measured on the video (lobby clock = video seconds - 3.12): a lock-on box flashes on the map's target at 4.40 s, the night
   gives way to the dusk at 5.05 s (dims to black over a dim grid while a ~970 px soft band of dusk sweeps in left to right,
   5.08-5.35 s), the dusk cross-fades back to night at 17.47-18.10 s, and the next switch comes at 25.07 s.
   Placements (D:\sp-video\match_bg.py): the night map is bkg_01 x1.54 at (-146,-121); the dusk gets the video's horizon
   height and dune size (x2.0); the ridges are bg_mountains_tiled x1.52 with their peaks where the video has them. */
export const CYC = 20, N2D = 1.93, DUSK = 12.42, XF = 0.63;
export function lobbyState(lt) {
  const c = ((lt - N2D) % CYC + CYC) % CYC; // 0 = the night -> dusk switch begins
  if (c < 0.3) return { c, night: 1 - smooth(clamp(c / 0.1)), dusk: c >= 0.031 ? 1 : 0, front: 8390 * (c - 0.031),
    grid: seg(c, 0.03, 0.08) * (1 - seg(c, 0.22, 0.3)), dark: c >= 0.133 ? 1 : 0 };
  if (c < DUSK) return { c, night: 0, dusk: 1, front: 1e4, grid: 0, dark: 1 };
  if (c < DUSK + XF) { const k = (c - DUSK) / XF; return { c, night: 1, dusk: 1 - k, front: 1e4, grid: 0, dark: 1 - k }; }
  return { c, night: 1, dusk: 0, front: 1e4, grid: 0, dark: 0 };
}
/** Seconds until the cycle next changes anything on screen (0 while it moves). */
function lobbyIdle(lt) {
  const c = ((lt - N2D) % CYC + CYC) % CYC;
  if (c < 0.31 || c >= CYC - 0.7 || (c >= DUSK && c < DUSK + XF + 0.02)) return 0;
  return c < DUSK ? DUSK - c : CYC - 0.7 - c;
}
function topoSVG(svg) { // terrain contours inside the lock-on box (no sprite exists for them): two nests of wobbly rings
  let p = '';
  for (const [cx, cy, n, ph] of [[40, 74, 5, 0], [96, 36, 4, 2]]) {
    for (let k = 1; k <= n; k++) {
      let d = '';
      const R = k * 12;
      for (let i = 0; i <= 60; i++) {
        const a = i / 60 * Math.PI * 2, r = R * (1 + 0.2 * Math.sin(3 * a + k + ph) + 0.1 * Math.sin(5 * a - 2 * k));
        d += (i ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + 0.8 * r * Math.sin(a)).toFixed(1);
      }
      p += `<path d="${d}Z"/>`;
    }
  }
  svg.innerHTML = `<g fill="none" stroke="#d9a548" stroke-width="1.2">${p}</g>`;
}
function lobbyHTML() {
  const scan = spriteUrl('scan'), ridge = `background-image:url("${spriteUrl('ridge')}")`;
  return `<div class="spa-scene" data-k="nightS">
      <img class="spa-night" src="${spriteUrl('night')}" alt="">
      <div class="spa-ridge spa-ridgeN" style='${ridge}'></div>
      <div class="spa-L" data-k="lock" style="opacity:0">
        <div class="spa-lockLine" data-k="lockLo" style="left:290px;width:53px;opacity:0"></div><div class="spa-lockLine" data-k="lockLi" style="left:350px;width:25px;transform-origin:100% 50%"></div>
        <div class="spa-lockLine" data-k="lockRi" style="left:500px;width:22px;transform-origin:0 50%"></div><div class="spa-lockLine" data-k="lockRo" style="left:522px;width:80px;opacity:0"></div>
        <div class="spa-lockBk spa-lockBL" data-k="lockBL"></div><div class="spa-lockBk spa-lockBR" data-k="lockBR"></div>
        <div class="spa-lockBox" data-k="lockBox"><div class="spa-glow" data-k="lockGlow"></div><svg class="spa-lockTopo" data-k="lockTopo" viewBox="0 0 125 123"></svg></div>
      </div>
    </div>
    <div class="spa-L spa-lgrid" data-k="lgrid"></div>
    <div class="spa-scene" data-k="duskS"><img class="spa-dusk" src="${spriteUrl('dusk')}" alt=""><div class="spa-ridge spa-ridgeD" style='${ridge}'></div></div>
    <div class="spa-L spa-lobbyShade"></div>
    <div class="spa-L spa-lobbyScan" style='background-image:url("${scan}")'></div>
    <div class="spa-L spa-vig"></div>`;
}
/** Draw the lobby at lobby clock `lt` (seconds); returns its state. */
function lobbyFrame(E, lt) {
  const S = lobbyState(lt);
  E.nightS.style.opacity = S.night.toFixed(3);
  E.duskS.style.opacity = S.dusk.toFixed(3);
  const m = S.front < 1280 + 970 ? `linear-gradient(90deg,#000 ${(S.front - 970).toFixed(0)}px,transparent ${S.front.toFixed(0)}px)` : 'none';
  E.duskS.style.webkitMaskImage = E.duskS.style.maskImage = m;
  E.lgrid.style.opacity = S.grid.toFixed(3);
  // lock-on box on the map's target, 0.65 s before the switch (u < 0)
  const u = S.c > CYC - 1 ? S.c - CYC : S.c;
  const on = u >= -0.69 && u < 0.12;
  E.lock.style.opacity = on ? seg(u, -0.69, -0.665).toFixed(2) : '0';
  if (on) {
    const box = E.lockBox, hot = seg(u, -0.66, -0.58) * (1 - seg(u, -0.52, -0.42)); // glow peaks at video 4.5 s
    box.style.borderColor = hot > 0.05 ? `rgb(${154 + 70 * hot | 0},${118 + 60 * hot | 0},${56 + 20 * hot | 0})` : '#9a7638';
    box.style.boxShadow = hot > 0.05 ? `0 0 ${(16 * hot).toFixed(1)}px rgba(255,190,80,${(0.8 * hot).toFixed(2)})` : 'none';
    E.lockGlow.style.opacity = hot.toFixed(2);
    box.style.transform = `scale(${(1 + 0.1 * (1 - seg(u, -0.69, -0.64))).toFixed(3)})`;
    const g = seg(u, -0.45, -0.3);
    [E.lockLi, E.lockRi, E.lockBL, E.lockBR].forEach((e) => { e.style.opacity = g.toFixed(2); });
    [E.lockLo, E.lockRo].forEach((e) => { e.style.opacity = (0.5 * seg(u, -0.35, -0.2)).toFixed(2); });
    E.lockLi.style.transform = E.lockRi.style.transform = `scaleX(${g.toFixed(3)})`;
    E.lockTopo.style.opacity = (0.75 * seg(u, -0.18, -0.05)).toFixed(2);
  }
  return S;
}

// one clock for every copy of the cycle on the page: the intro's last second and the backdrop under it show the same
// moment, and the cycle runs on when the lobby is left and entered again
let cycleOrigin = null;
const wakers = new Set();
/** Lobby clock 0 is at `ms` (performance.now() time); a mounted backdrop follows at once. */
export function setCycleOrigin(ms) { cycleOrigin = ms; wakers.forEach((fn) => fn()); }
function cycleNow(now = performance.now()) {
  if (cycleOrigin == null) cycleOrigin = now - 480; // a plain visit lands on the night, 1.5 s before its switch to dusk
  return (now - cycleOrigin) / 1000;
}

/**
 * Mount the lobby backdrop into `host` (its stage covers the host). Returns { destroy, setMotion }.
 * Motion off: the night, still. The loop sleeps through the still parts of the cycle and while the page is hidden.
 */
export function mountAllianceBackdrop(host, { motion = true } = {}) {
  ensureShared();
  const stage = document.createElement('div');
  stage.className = 'spa-stage';
  stage.innerHTML = lobbyHTML();
  host.append(stage);
  const E = refs(stage);
  topoSVG(E.lockTopo);
  const fit = () => {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    stage.style.transform = `translate(-50%,-50%) scale(${Math.max(w / 1280, h / 720)})`;
  };
  fit();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  if (ro) ro.observe(host); else addEventListener('resize', fit);
  let raf = 0, timer = 0, dead = false, moving = motion;
  const tick = () => {
    raf = 0; timer = 0;
    if (dead) return;
    if (!moving) { lobbyFrame(E, 0.48); return; }
    const lt = cycleNow();
    lobbyFrame(E, lt);
    if (document.hidden) return; // visibilitychange wakes it
    const idle = lobbyIdle(lt);
    if (idle > 0.05) timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, (idle - 0.03) * 1000);
    else raf = requestAnimationFrame(tick);
  };
  const wake = () => { if (dead) return; cancelAnimationFrame(raf); clearTimeout(timer); raf = requestAnimationFrame(tick); };
  document.addEventListener('visibilitychange', wake);
  wakers.add(wake);
  lobbyFrame(E, moving ? cycleNow() : 0.48);
  wake();
  return {
    setMotion(on) { moving = !!on; wake(); },
    destroy() {
      dead = true; cancelAnimationFrame(raf); clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      wakers.delete(wake);
      if (ro) ro.disconnect(); else removeEventListener('resize', fit);
      stage.remove();
    },
  };
}

// ======================= the entry animation =======================
// --- opening rows: box left edge, tops, heights ---
const ROWX = curve([[1.267, 560], [1.30, 384], [1.333, 128], [1.367, 0], [1.40, -222], [1.433, -640], [1.467, -1200]]);
const Y1 = curve([[1.267, 310], [1.30, 285], [1.333, 251], [1.367, 227], [1.40, 195], [1.433, 160], [1.467, 123], [1.50, 90], [1.533, 62], [1.567, 50], [1.60, 40], [1.633, 34]]);
const H1 = curve([[1.30, 99], [1.40, 97], [1.433, 92], [1.467, 89], [1.50, 82], [1.533, 78], [1.567, 67], [1.60, 65], [1.633, 60]]);
const YR2 = curve([[1.267, 734], [1.30, 695], [1.333, 656], [1.367, 624], [1.40, 578], [1.433, 524], [1.467, 468], [1.50, 418], [1.533, 370], [1.567, 330], [1.60, 298], [1.633, 290]]);
const HR2 = curve([[1.30, 40], [1.367, 35], [1.40, 34], [1.433, 38], [1.467, 37], [1.50, 29], [1.533, 15], [1.567, 20], [1.60, 8], [1.633, 14]]);
const YB = curve([[1.267, 400], [1.30, 392], [1.333, 384], [1.367, 373], [1.40, 362], [1.433, 348], [1.467, 330], [1.50, 312], [1.533, 285], [1.567, 252], [1.60, 205], [1.633, 170]]);
const HB = curve([[1.30, 96], [1.40, 98], [1.467, 102], [1.50, 100], [1.533, 85], [1.567, 78], [1.60, 93], [1.633, 98]]);
const BA = curve([[1.30, 0.5], [1.467, 0.5], [1.50, 0.42], [1.533, 0.3], [1.60, 0.26], [1.633, 0.2], [1.67, 0]]);
const YL = curve([[1.40, 320], [1.433, 312], [1.467, 305], [1.50, 296], [1.533, 282], [1.567, 262], [1.60, 256], [1.633, 270]]);
const HL = curve([[1.367, 30], [1.40, 42], [1.433, 36], [1.467, 25], [1.50, 14], [1.533, 5], [1.60, 8], [1.633, 15]]);
const YBOT = curve([[1.40, 646], [1.467, 630], [1.567, 604], [1.60, 574], [1.633, 556]]);
const RB = curve([[1.267, 0], [1.30, 0.15], [1.333, 0.43], [1.367, 0.7], [1.40, 1]]); // brightness of the grey screen
const BASEA = curve([[1.40, 1], [1.433, 0.55], [1.467, 0.25], [1.50, 0]]); // grey screen gives way to the scene
// --- background: pan (bright phase) then a damped pull-back about (606,330) ---
const SBG = curve([[1.40, 2.06], [1.50, 2.02], [1.567, 1.98], [1.60, 1.95], [1.633, 1.90], [1.667, 1.84], [1.70, 1.78], [1.733, 1.70], [1.767, 1.63], [1.80, 1.57], [1.833, 1.50], [1.867, 1.43], [1.90, 1.37], [1.933, 1.32], [1.967, 1.29], [2.0, 1.24], [2.033, 1.20], [2.1, 1.17], [2.2, 1.14], [2.333, 1.08], [2.467, 1.055], [2.6, 1.03], [2.733, 1.014], [2.867, 1.0], [3.3, 1.0]]);
const LIGHT = curve([[1.30, 0.35], [1.40, 0.5], [1.467, 0.65], [1.50, 0.75], [1.567, 0.9], [1.60, 1], [1.80, 1], [1.833, 0.95], [1.867, 0.88], [1.90, 0.78], [1.933, 0.63], [1.967, 0.46], [2.0, 0.31], [2.1, 0.3], [2.4, 0.28], [2.7, 0.22], [2.9, 0.12], [3.05, 0.06]]);
// --- HUD squares grow in place (centres fixed: big 896,338 / small 294,367 / tiny 744,449) ---
const BIGBOX = K([[1.48, 848, 944, 301, 375], [1.50, 836, 956, 291, 385], [1.533, 822, 970, 280, 396], [1.567, 809, 977, 269, 408], [1.60, 792, 996, 256, 416], [1.667, 782, 1010, 247, 427],
  [1.70, 780, 1013, 247, 427], [1.767, 773, 1020, 243, 436], [1.80, 773, 1020, 240, 436], [1.90, 815, 1024, 236, 435], [1.967, 848, 1030, 232, 432], [2.2, 848, 1032, 232, 440], [2.45, 848, 1032, 232, 440]]);
const WSM = curve([[1.605, 0], [1.62, 30], [1.633, 40], [1.667, 50], [1.70, 55], [1.733, 62], [1.767, 68], [1.80, 74], [1.833, 76], [1.90, 76], [1.967, 78], [2.033, 82], [2.4, 85]]);
const WTI = curve([[1.75, 0], [1.767, 36], [1.80, 44], [2.0, 46]]);
// --- the rail: one strip whipped left at ~850 px per frame; X = its shift from where it sits at 1.767 s ---
const XR = (t) => 25500 * (1.767 - t);
const C1Y = curve([[1.633, 437], [1.667, 430], [1.70, 420], [1.733, 403], [1.767, 393]]), C1W = curve([[1.633, 30], [1.667, 28], [1.70, 40], [1.733, 33], [1.767, 13]]);
const C2Y = curve([[1.633, 474], [1.667, 470], [1.70, 466], [1.733, 448], [1.767, 442]]);
const C3Y = curve([[1.633, 497], [1.667, 497], [1.70, 490], [1.733, 470], [1.767, 460]]);
const C4Y = curve([[1.633, 512], [1.667, 512], [1.70, 500], [1.733, 480], [1.767, 472]]);
const C5Y = curve([[1.633, 543], [1.667, 543], [1.70, 523], [1.733, 498], [1.767, 482]]), C5W = curve([[1.633, 33], [1.667, 33], [1.70, 20], [1.733, 22], [1.767, 10]]);
const SLT = curve([[1.733, 389], [1.767, 380]]), SLB = curve([[1.733, 509], [1.767, 489]]);
// --- crosses (top-left one; the others mirror about x 640 / y 390) ---
const CROSS = K([[1.48, 134, 164], [1.75, 131, 158], [1.80, 131, 158], [1.95, 104, 132], [2.0, 94, 124], [2.067, 88, 116], [2.2, 80, 106], [2.4, 74, 100], [2.667, 72, 100]]);
// --- side brackets on the line (inner x of the left one; lines run from the screen edge to them) ---
const HBX = curve([[1.88, 0], [1.90, 32], [1.967, 106], [2.0, 160], [2.1, 240], [2.2, 300], [2.4, 390], [2.667, 430], [2.8, 440]]);
// --- the lockup (screen space). card = dark card / dark backdrop: cx, cy, w, h ---
const CARD = K([[1.833, 1036, 329, 240, 240], [1.867, 890, 322, 238, 238], [1.90, 818, 316, 234, 234], [1.933, 765, 312, 230, 230], [1.967, 727, 309, 228, 228],
  [2.0, 702, 306, 226, 226], [2.033, 681, 303, 222, 222], [2.1, 661, 296, 215, 215], [2.2, 645, 286, 207, 207], [2.3, 638, 277, 202, 202], [2.367, 639, 272, 236, 204], [2.4, 639.5, 271, 245, 204], [2.5, 640, 264, 248, 200]]);
// cream panel: cx, cy, w (square); then it shrinks into the pyramid (2.933-3.16 s)
const CREAM = K([[2.0, 702, 306, 226], [2.033, 681, 303, 222], [2.1, 661, 296, 215], [2.2, 645, 286, 207], [2.3, 638, 277, 202], [2.4, 639, 270, 202], [2.5, 640, 263, 200],
  [2.6, 640, 255, 196], [2.7, 640, 247, 192], [2.8, 640, 235, 186], [2.9, 640, 224, 176], [2.933, 640, 221, 172], [2.967, 640, 216, 164], [3.0, 640, 207, 152],
  [3.033, 640, 197, 132], [3.067, 640, 186, 102], [3.1, 641, 168, 53], [3.133, 640, 159, 24], [3.16, 640, 152, 0]]);
// wipe of the cream across the card, from its left edge
const WIPE = curve([[2.0, 0], [2.033, 0.2], [2.067, 0.4], [2.1, 0.59], [2.133, 0.73], [2.167, 0.83], [2.2, 0.87], [2.267, 0.94], [2.3, 0.975], [2.333, 1]]);
// pyramid after the lockup has settled: cy, w
const PYR = K([[2.933, 228, 150], [2.967, 222, 152], [3.0, 215, 155], [3.033, 206, 156], [3.067, 195, 156], [3.1, 178, 154], [3.133, 164, 150], [3.167, 156, 146], [3.2, 150, 144], [3.333, 147, 144], [3.5, 145, 144], [3.8, 144, 144]]);
// brackets around the card / lobby title: xl, xr, yt, yb
const BRK = K([[2.37, 513, 764, 172, 376], [2.4, 511, 766, 169, 373], [2.533, 509, 769, 161, 361], [2.667, 511, 767, 153, 347], [2.8, 514, 762, 141, 330], [2.933, 521, 758, 130, 310],
  [3.0, 524, 755, 122, 293], [3.067, 530, 749, 110, 265], [3.133, 540, 742, 90, 230], [3.2, 545, 737, 85, 220], [3.333, 549, 733, 80, 212], [3.5, 552, 730, 78, 207]]);
// glyph line: cx, cy, w (ink)
const TA = K([[1.833, 1035, 492, 337], [1.867, 888, 483.5, 334], [1.90, 817, 475, 329], [1.933, 765, 471, 326], [1.967, 727, 467, 322], [2.0, 702, 460, 316], [2.067, 670, 447.5, 306],
  [2.1, 661, 443, 302], [2.2, 645, 431.5, 295], [2.3, 638, 420.5, 290], [2.333, 639, 415, 289], [2.4, 640, 408, 286], [2.5, 640, 398, 280], [2.6, 640, 387, 275], [2.7, 640, 376.5, 270],
  [2.8, 640, 362.5, 264], [2.9, 640, 348.5, 259], [2.933, 640, 343.5, 258], [2.967, 640, 338, 256], [3.0, 640, 327, 250], [3.033, 640, 313, 240], [3.067, 640, 297, 230], [3.1, 640, 271.5, 216],
  [3.133, 640, 256.5, 207], [3.167, 640, 246, 199], [3.2, 640, 239.5, 194], [3.267, 640, 235.5, 190], [3.333, 640, 232.5, 188], [3.4, 640, 230.5, 186], [3.5, 640, 227.5, 186]]);
// STRONGHOLD PROTOCOL: cx, cap top, w (ink); cap height = .0866 w
const TB = K([[1.833, 1036, 520, 439], [1.867, 890, 510, 434], [1.90, 818, 502, 429], [1.933, 766, 497, 420], [1.967, 728, 489, 410], [2.0, 703, 482, 400], [2.067, 671, 473, 384],
  [2.1, 662, 468, 378], [2.2, 646, 456, 368], [2.3, 636, 444, 362], [2.333, 636, 439, 361], [2.4, 636, 432, 356], [2.5, 636, 421, 350], [2.6, 636, 410, 343], [2.7, 636, 399, 337],
  [2.8, 636, 384, 329], [2.9, 636, 370, 323], [2.933, 636, 365, 321], [2.967, 636, 359, 319], [3.0, 636, 348, 311], [3.033, 636, 334, 300], [3.067, 636, 317, 287], [3.1, 636, 291, 267],
  [3.133, 636, 275, 257], [3.167, 636, 265, 248], [3.2, 636, 258, 242], [3.267, 636, 253, 237], [3.333, 636, 250, 235], [3.4, 636, 247, 233], [3.5, 636, 244, 231]]);
// text colour sweep (dark ink -> pale), left to right, 2.04-2.33 s
const SWEEP = curve([[2.04, 0], [2.067, 0.3], [2.1, 0.45], [2.133, 0.6], [2.167, 0.7], [2.2, 0.8], [2.267, 0.92], [2.333, 1]]);
// ALLIANCE: cx, cy, w (letters); revealed from the centre out (fraction of its width)
const TC = K([[2.0, 702, 554, 170], [2.033, 681, 546, 170], [2.067, 671, 538, 169], [2.1, 662, 531, 168], [2.133, 656, 524, 168], [2.167, 651, 518, 167], [2.2, 646, 514, 166],
  [2.233, 644, 508, 166], [2.267, 642, 504, 165], [2.3, 640, 499, 165], [2.4, 640, 484, 161], [2.5, 640, 472, 158], [2.6, 640, 460, 155], [2.7, 640, 447, 152], [2.8, 640, 432, 148],
  [2.9, 640, 416, 146], [2.933, 640, 411, 144], [2.967, 640, 404, 144], [3.0, 640, 392, 140], [3.033, 640, 376, 136], [3.067, 640, 358, 130], [3.1, 640, 328, 124], [3.133, 640, 311, 118],
  [3.167, 640, 297.5, 115], [3.2, 640, 290, 112], [3.267, 640, 284, 109], [3.333, 640, 279.5, 107], [3.4, 640, 276.5, 106], [3.5, 640, 272.5, 104]]);
const REVEAL = curve([[1.995, 0], [2.0, 0.08], [2.033, 0.24], [2.067, 0.40], [2.1, 0.56], [2.133, 0.69], [2.167, 0.80], [2.2, 0.87], [2.233, 0.95], [2.267, 1]]);
// block under ALLIANCE: cx, cy, w
const TD = K([[1.833, 1034, 615, 151], [1.867, 888, 605, 149], [1.90, 817, 597, 147], [1.967, 727, 585, 142], [2.067, 670, 572, 133], [2.1, 662, 568, 131], [2.2, 646, 559, 126],
  [2.3, 640, 547, 122], [2.4, 640, 534, 118], [2.5, 640, 521, 116], [2.6, 640, 509, 114], [2.7, 640, 496, 112], [2.8, 640, 479, 109], [2.9, 640, 463, 107], [2.933, 640, 458, 106],
  [2.967, 640, 451, 105], [3.0, 640, 440, 100], [3.033, 640, 425, 96], [3.067, 640, 405, 90]]);
// 卫戍协议: 盟约 (fades in during the hand-off): cx, cy, w
const TE = K([[3.08, 639, 372, 222], [3.1, 639, 362, 215], [3.133, 639, 348.5, 207], [3.167, 639, 333, 195], [3.2, 639, 324, 190], [3.233, 639, 319.5, 186], [3.267, 639, 316.5, 182],
  [3.3, 639, 313.5, 180], [3.333, 639, 310.5, 178], [3.4, 639, 307, 176], [3.5, 639, 302.5, 174]]);

const TE_REF = '卫戍协议: 盟约'; // i18n-ignore (the film's own Chinese line: the size every language is set at)

/** Video seconds of the soundtrack: the event's entry sound and its lobby music (from its start, 0.8 s fade-in). */
export const INTRO_AUDIO = { sfxAt: 1.6856, bgmAt: 2.1444 };
/** Video seconds the intro shows: from just before the grey screen comes up to the end of the hand-off to the lobby. */
export const INTRO_SPAN = { from: 1.2, fadeAt: 3.45, to: 4.0 };

// blocky "alien" glyph line (no sprite / font exists for it): 19 cells of 11x14, advance 13.5
function glyphSVG(svg, n, seed) {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let p = '';
  for (let i = 0; i < n; i++) {
    if (i === 10) continue;
    const x = i * 13.5, w = 11, h = 14, v = Math.floor(r() * 6), cut = 3 + Math.floor(r() * 3);
    let pts;
    if (v === 0) pts = [[x, 0], [x + w, 0], [x + w, h - cut], [x + w - cut, h], [x, h]];
    else if (v === 1) pts = [[x + cut, 0], [x + w, 0], [x + w, h], [x, h], [x, cut]];
    else if (v === 2) pts = [[x, 0], [x + w, 0], [x + w, h], [x + w * 0.55, h], [x + w * 0.55, h * 0.55], [x + w * 0.4, h * 0.55], [x + w * 0.4, h], [x, h]];
    else if (v === 3) pts = [[x, 0], [x + w - cut, 0], [x + w, cut], [x + w, h], [x, h]];
    else if (v === 4) pts = [[x, 0], [x + w, 0], [x + w, h * 0.4], [x + w * 0.6, h * 0.4], [x + w * 0.6, h * 0.6], [x + w, h * 0.6], [x + w, h], [x, h]];
    else pts = [[x, cut], [x + cut, 0], [x + w, 0], [x + w, h - cut], [x + w - cut, h], [x, h]];
    p += `<polygon points="${pts.map((q) => q.join(',')).join(' ')}"/>`;
  }
  const gid = `spa-gsw${seed}-${Math.random().toString(36).slice(2, 8)}`;
  svg.setAttribute('viewBox', `0 0 ${n * 13.5 - 2.5} 14`); svg.setAttribute('width', n * 13.5 - 2.5); svg.setAttribute('height', 14);
  svg.innerHTML = `<defs><linearGradient id="${gid}" x1="0" x2="1"><stop offset="0" stop-color="#f4f4f0"/><stop class="spa-gs1" offset="0" stop-color="#f4f4f0"/><stop class="spa-gs2" offset="0" stop-color="#151b1e"/><stop offset="1" stop-color="#151b1e"/></linearGradient></defs><g fill="url(#${gid})">${p}</g>`;
  return n * 13.5 - 2.5;
}
// rail cables: filled ribbons (top edge + bottom edge share the same S-bend), so they can taper
function ribbon(p, X, yl, wl, yr, wr, a, b, xEnd) { // left band (yl,wl) -> S-bend over rail x a..b -> right band (yr,wr) up to rail x xEnd
  const A = a + X, B = b + X, E = xEnd + X, k = (B - A) * 0.45;
  const t1 = yl - wl / 2, b1 = yl + wl / 2, t2 = yr - wr / 2, b2 = yr + wr / 2;
  p.setAttribute('d', `M -3000 ${t1} L ${A} ${t1} C ${A + k} ${t1} ${B - k} ${t2} ${B} ${t2} L ${E} ${t2} L ${E} ${b2} L ${B} ${b2} C ${B - k} ${b2} ${A + k} ${b1} ${A} ${b1} L -3000 ${b1} Z`);
}
// HUD square colours: dark teal over the bright fog, light teal once the fog goes dark
function sqStyle(el, L, light) {
  el.style.background = L > 0.55 ? 'linear-gradient(200deg,rgba(76,116,130,.92),rgba(28,56,68,.92))'
    : `linear-gradient(200deg,rgba(${light[0]},${light[1]},${light[2]},.9),rgba(${light[0] - 20},${light[1] - 25},${light[2] - 25},.85))`;
}

function introHTML() {
  const fog = spriteUrl('fog'), ship = spriteUrl('ship'), logo = spriteUrl('logo'), cross = spriteUrl('cross'), scan = spriteUrl('scan');
  const crossImg = `<img class="spa-cross" data-k="cross" src="${cross}" alt="">`;
  return `<div class="spa-L" data-k="lobby">${lobbyHTML()}</div>
  <div class="spa-L spa-intro" data-k="intro">
    <div class="spa-cam" data-k="cam">
      <div class="spa-bgTone"></div>
      <img class="spa-fog" data-k="fog" src="${fog}" alt="">
      <img class="spa-fog2" data-k="fog2" src="${fog}" alt="">
      <div class="spa-shade" data-k="shade"></div>
      <img class="spa-ship" data-k="shipA" src="${ship}" alt=""><img class="spa-ship" data-k="shipB" src="${ship}" alt="">
    </div>
    <div>
      <div class="spa-hud" data-k="sqBig"><i style="left:-1px;top:-1px"></i><i style="right:-1px;top:-1px"></i><i style="left:-1px;bottom:-1px"></i><i style="right:-1px;bottom:-1px"></i></div>
      <div class="spa-hud" data-k="sqSmall"></div>
      <div class="spa-hud" data-k="sqTiny"></div>
    </div>
    <div class="spa-L" data-k="rows">
      <div class="spa-rowsBase" data-k="rowsBase"><div class="spa-vg"></div></div>
      <div class="spa-bband" data-k="bband"></div><div class="spa-band" data-k="band"></div><div class="spa-lline" data-k="lline"></div><div class="spa-r1slab" data-k="r1slab"></div><div class="spa-r2bar" data-k="r2bar"></div>
      <div class="spa-row" data-k="row1"><div class="spa-ear"></div><div class="spa-box">01</div><div class="spa-tick"></div><div class="spa-rslab" data-k="row1slab"></div><svg class="spa-cap" data-k="cap1"></svg></div>
      <div class="spa-row" data-k="row2"><div class="spa-ear"></div><div class="spa-box">02</div><div class="spa-tick"></div></div>
    </div>
    <svg class="spa-rail" data-k="rail" viewBox="0 0 1280 720"></svg>
    <div class="spa-slab" data-k="slab">
      <div class="spa-s" data-k="sBlock" style="left:327px;width:110px"></div>
      <div class="spa-s" data-k="sMain" style="left:447px;width:457px;clip-path:polygon(0 0,100% 0,100% 34%,97.6% 34%,97.6% 66%,100% 66%,100% 100%,0 100%)"></div>
      <div data-k="sTxt" style="position:absolute;left:740px;font-size:22px;color:#6f8188;letter-spacing:.04em">INPUT ▸</div>
      <div class="spa-s" style="left:907px;top:433px;width:60px;height:7px"></div>
      <div class="spa-s" style="left:653px;top:347px;width:100px;height:9px;background:#26333a"></div>
      <div style="position:absolute;left:713px;top:514px;font-size:9px;color:#33454c;white-space:nowrap">■&nbsp;&nbsp;STRONGHOLD PROTOCOL</div>
    </div>
    <div class="spa-L spa-introScan" data-k="introScan" style='background-image:url("${scan}")'></div>
    <canvas class="spa-grain" data-k="grain"></canvas>
    <div class="spa-L">
      ${crossImg}${crossImg}${crossImg}${crossImg}
      <div class="spa-hb" data-k="hbL"></div><div class="spa-hb" data-k="hbR"></div>
      <div class="spa-hbk" data-k="hbkL" style="border-left:none"></div><div class="spa-hbk" data-k="hbkR" style="border-right:none"></div>
      <div class="spa-orange" data-k="orange">RHODES ISLAND STRONGHOLD PROTOCOL</div>
    </div>
  </div>
  <div class="spa-L spa-logo" data-k="logo">
    <div class="spa-a0 spa-card" data-k="card"></div>
    <div class="spa-a0 spa-brk spa-bkL" data-k="bkL"></div><div class="spa-a0 spa-brk spa-bkR" data-k="bkR"></div>
    <div class="spa-a0 spa-abs" data-k="abs"><span>AB1</span><span>AB2</span><span>AB3</span><span>AB4</span></div>
    <div class="spa-pyr" data-k="pyr"><img class="spa-pyrTeal" data-k="pyrTeal" src="${logo}" alt=""><img data-k="pyrWhite" src="${logo}" alt=""></div>
    <div class="spa-a0 spa-cream" data-k="cream"><img class="spa-pyrBlack" data-k="pyrBlack" src="${logo}" alt=""></div>
    <svg class="spa-a0" data-k="tA"></svg>
    <div class="spa-a0 spa-tline spa-tB" data-k="tB"><span class="spa-ink" data-k="tBink">STRONGHOLD PROTOCOL</span><span class="spa-pale" data-k="tBpale">STRONGHOLD PROTOCOL</span></div>
    <div class="spa-a0 spa-tline spa-tC" data-k="tC"><span data-k="tCtxt">${[...'ALLIANCE'].map((c) => `<span>${c}</span>`).join('')}</span></div>
    <div class="spa-dot2" data-k="dotL"></div><div class="spa-dot2" data-k="dotR"></div>
    <div class="spa-a0 spa-blk" data-k="blk"><div class="spa-bars"><i></i><i></i></div><div class="spa-lines"><b><span>STRONGHOLD PROTOCOL</span></b><s>ALLIED OPERATIONS ·</s></div></div>
    <div class="spa-a0 spa-tline spa-tE" data-k="tE"><span data-k="tEa"></span><em data-k="tEb"></em></div>
    <div class="spa-a0 spa-tline spa-tE" data-k="tEref" style="visibility:hidden"></div>
  </div>`;
}

/**
 * Mount the entry animation into `host` (a full-screen box; the 1280×720 stage is fitted into it, letting up to 20 %
 * spill past the edges rather than leaving wide black bars). Returns { stage, render(T), grain(), measure(), destroy() }:
 * render draws video second T (1.2 … 4.0), the caller drives the clock.
 */
export function mountAllianceIntro(host) {
  ensureShared();
  const stage = document.createElement('div');
  stage.className = 'spa-stage';
  stage.innerHTML = introHTML();
  host.append(stage);
  const E = refs(stage);
  topoSVG(E.lockTopo);
  const cross = [].concat(E.cross);
  let scale = 1;
  const fit = () => {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    const fitS = Math.min(w / 1280, h / 720), cover = Math.max(w / 1280, h / 720);
    scale = Math.min(cover, fitS * 1.2);
    stage.style.transform = `translate(-50%,-50%) scale(${scale})`;
  };
  fit();
  addEventListener('resize', fit);

  // grain
  const gc = E.grain, gg = gc.getContext('2d');
  gc.width = 426; gc.height = 240;
  const gimg = gg ? gg.createImageData(426, 240) : null;
  const grain = () => {
    if (!gimg) return;
    const d = gimg.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    gg.putImageData(gimg, 0, 0);
  };
  const GA_W = glyphSVG(E.tA, 19, 7);
  const gStops = [E.tA.querySelector('.spa-gs1'), E.tA.querySelector('.spa-gs2')];
  glyphSVG(E.cap1, 17, 11);
  E.cap1.setAttribute('preserveAspectRatio', 'none');
  E.cap1.querySelector('g').setAttribute('fill', '#1a2328');
  const NSV = 'http://www.w3.org/2000/svg';
  const ribbons = [['#141c21', 0.93], ['rgba(196,220,228,.36)', 1], ['#18242a', 0.9], ['rgba(196,220,228,.3)', 1], ['#141c21', 0.93]].map(([c, o]) => {
    const p = document.createElementNS(NSV, 'path'); p.setAttribute('fill', c); p.setAttribute('opacity', o); E.rail.appendChild(p); return p;
  });
  const tcLetters = [...E.tCtxt.children], absTabs = [...E.abs.children];
  // the lockup's sentence in the page's language, at the size the Chinese one has in the film
  E.tEref.textContent = TE_REF;
  E.tEa.textContent = t('卫戍协议') + ': ';
  E.tEb.textContent = t('盟约');

  /* natural sizes of the scalable text blocks. A hidden block measures 0, so the logo layer and each block are shown for
     the moment of measuring; the logo re-measures any block that has no size yet (fonts arriving late). */
  const NAT = {}, NAT_IDS = ['tB', 'tC', 'tE', 'tEref', 'blk', 'abs'];
  const measure = () => {
    const lg = E.logo, ld = lg.style.display;
    lg.style.display = '';
    for (const id of NAT_IDS) {
      const e = E[id], d = e.style.display, tf = e.style.transform;
      e.style.display = ''; e.style.transform = 'none';
      const r = e.getBoundingClientRect();
      if (r.width > 0) NAT[id] = { w: r.width / scale, h: r.height / scale };
      e.style.display = d; e.style.transform = tf;
    }
    lg.style.display = ld;
  };

  function intro(t) {
    const L = LIGHT(t);
    // ---- background ----
    E.cam.style.transform = `scale(${SBG(t).toFixed(4)})`;
    E.cam.style.visibility = t >= 1.40 ? 'visible' : 'hidden';
    E.fog.style.filter = `brightness(${(L > 0.5 ? 0.08 + 1.1 * L : 0.04 + 0.48 * L).toFixed(3)}) contrast(1.05) saturate(.9)`;
    E.fog2.style.opacity = (seg(t, 1.9, 2.05) * (1 - 0.45 * seg(t, 2.7, 3.0))).toFixed(3);
    E.fog2.style.filter = 'brightness(.52) saturate(.85)';
    // bright phase: the ship only darkens the fog where it has dark detail; dark phase: a dim grey hull
    E.shipA.style.filter = 'brightness(1.02) saturate(.62) contrast(1.05)';
    E.shipA.style.opacity = (0.88 * (1 - seg(t, 1.9, 1.99))).toFixed(3);
    E.shade.style.opacity = (seg(t, 1.45, 1.6) * (1 - seg(t, 1.92, 2.02))).toFixed(3);
    E.shipB.style.filter = `contrast(4) brightness(${(0.17 + 0.1 * L).toFixed(3)}) saturate(.5)`;
    E.shipB.style.opacity = (0.92 * seg(t, 1.88, 1.99) * (1 - seg(t, 2.72, 3.0))).toFixed(3);
    // ---- HUD squares ----
    const hudFade = 1 - seg(t, 2.2, 2.38);
    {
      const big = E.sqBig, on = t >= 1.48 && hudFade > 0; show(big, on);
      if (on) { const [x0, x1, y0, y1] = BIGBOX(t); place(big, x0, y0, x1 - x0, y1 - y0); sqStyle(big, L, [106, 150, 166]); big.style.opacity = hudFade.toFixed(2); }
    }
    [[E.sqSmall, WSM(t), 294, 367, 0.84, [78, 122, 138], false], [E.sqTiny, WTI(t), 744, 452, 0.6, [86, 126, 140], true]].forEach(([el, w, cx, cy, ar, lt, tiny]) => {
      show(el, w > 1 && hudFade > 0);
      if (w <= 1) return;
      place(el, cx - w / 2, cy - w * ar / 2, w, w * ar); sqStyle(el, L, lt);
      el.style.opacity = (tiny ? 1 - seg(t, 2.0, 2.2) : hudFade).toFixed(2);
    });
    // ---- opening rows ----
    const rv = t >= 1.267 && t < 1.64; show(E.rows, rv);
    if (rv) {
      const x = ROWX(t);
      E.rowsBase.style.opacity = BASEA(t).toFixed(3);
      E.rows.style.filter = t < 1.40 ? `brightness(${RB(t).toFixed(3)})` : 'none';
      const y1 = Y1(t), h1 = H1(t), yr = YR2(t), hr = HR2(t);
      show(E.row1, x > -700); show(E.row2, x > -700);
      E.row1.style.transform = `translate(${x.toFixed(0)}px,${y1.toFixed(1)}px)`; E.row2.style.transform = `translate(${x.toFixed(0)}px,${(yr - 42).toFixed(1)}px)`;
      // once the row boxes have left, their long bars go on as plain bands
      const solo = x < -560;
      E.row1slab.style.display = solo ? 'none' : '';
      show(E.r1slab, solo); E.r1slab.style.top = y1 + 'px'; E.r1slab.style.height = h1 + 'px';
      show(E.r2bar, true); E.r2bar.style.top = yr + 'px'; E.r2bar.style.height = Math.max(3, hr) + 'px';
      E.r2bar.style.left = (solo ? 0 : x + 318) + 'px'; E.r2bar.style.background = 'rgba(4,8,12,.5)';
      E.band.style.top = YB(t) + 'px'; E.band.style.height = HB(t) + 'px'; E.band.style.opacity = BA(t).toFixed(3);
      show(E.lline, t >= 1.36); E.lline.style.top = YL(t) + 'px'; E.lline.style.height = HL(t) + 'px';
      show(E.bband, t >= 1.40); E.bband.style.top = YBOT(t) + 'px'; E.bband.style.height = '36px';
      // the bars hand over to the rail at 1.633 s
      if (t >= 1.633) [E.r1slab, E.r2bar, E.lline, E.bband].forEach((e) => { e.style.display = 'none'; });
    }
    // ---- rail (1.633-1.80 s): bars bend into a cable bundle that whips left and ends in the INPUT slab ----
    const railOn = t >= 1.633 && t < 1.81; show(E.rail, railOn); show(E.slab, railOn);
    if (railOn) {
      const X = XR(t), yl1 = Y1(1.633) + H1(1.633) / 2;
      ribbon(ribbons[0], X, yl1, H1(1.633), C1Y(t), C1W(t), -2240, -1480, 313); // top bar -> top cable
      ribbon(ribbons[1], X, 278, 14, C2Y(t), 18, -2560, -1480, 313); // light line -> light cable
      ribbon(ribbons[2], X, YR2(1.633) + 7, 14, C3Y(t), 7, -2560, -1480, 313); // row-2 bar -> thin dark cable
      ribbon(ribbons[3], X, 574, 12, C4Y(t), 12, -2400, -1480, 313); // lower band -> light cable
      ribbon(ribbons[4], X, 790, 24, C5Y(t), C5W(t), -1830, -1480, 313); // from below the frame -> bottom cable
      E.slab.style.transform = `translateX(${X.toFixed(0)}px)`;
      const top = SLT(t), bot = SLB(t);
      [E.sBlock, E.sMain].forEach((e) => { e.style.top = top + 'px'; e.style.height = (bot - top) + 'px'; });
      E.sTxt.style.top = (top + (bot - top) / 2 - 12) + 'px';
    }
    // ---- screen HUD ----
    const [cxL, cyT] = CROSS(t), crossOn = t >= 1.48 && t < 2.87 && !(t > 1.785 && t < 1.94);
    cross.forEach((e, i) => {
      show(e, crossOn);
      const x = i % 2 ? 1280 - cxL : cxL, y = i < 2 ? cyT : 780 - cyT;
      e.style.transform = `translate(${x - 17.4}px,${y - 19.2}px) scale(.6)`;
      e.style.filter = L > 0.6 ? 'url(#spaBoostDark)' : 'url(#spaBoostPale)';
      e.style.opacity = (1 - seg(t, 2.72, 2.87)).toFixed(2);
    });
    const hb = HBX(t), hbOn = t >= 1.88 && t < 2.86, hbA = (1 - seg(t, 2.72, 2.86)).toFixed(2);
    [E.hbL, E.hbR, E.hbkL, E.hbkR].forEach((e) => { show(e, hbOn); e.style.opacity = hbA; });
    E.hbL.style.left = '0px'; E.hbL.style.width = hb + 'px'; E.hbR.style.left = (1280 - hb) + 'px'; E.hbR.style.width = hb + 'px';
    E.hbkL.style.left = (hb - 1) + 'px'; E.hbkR.style.left = (1280 - hb - 8) + 'px';
    E.orange.style.opacity = (0.55 * seg(t, 2.2, 2.35) * (1 - seg(t, 2.78, 2.9))).toFixed(2);
    const ov = t < 1.40 ? RB(t) : 1; // the grey opening screen comes up out of black, overlays included
    E.grain.style.opacity = ((t < 1.5 ? 0.24 : 0.16) * ov).toFixed(3); E.introScan.style.opacity = (0.8 * ov).toFixed(3);
  }

  function logo(t) {
    const on = t >= 1.833; show(E.logo, on);
    if (!on) return;
    if (NAT_IDS.some((id) => !NAT[id])) measure();
    const tc = Math.min(t, 3.5);
    // card / dark backdrop
    const [ccx, ccy, cw, ch] = CARD(tc), cardOn = t < 2.5;
    show(E.card, cardOn);
    if (cardOn) { place(E.card, ccx - cw / 2, ccy - ch / 2, cw, ch); E.card.style.opacity = (t < 1.86 && Math.random() < 0.3 ? 0.45 : 1 - seg(t, 2.4, 2.5)).toFixed(2); }
    // cream panel: wipes in from the card's left edge, then shrinks into the pyramid
    const [kx, ky, kw] = CREAM(tc), creamOn = t >= 2.0 && kw > 0.5;
    show(E.cream, creamOn);
    const wipe = WIPE(t);
    if (creamOn) { place(E.cream, kx - kw / 2, ky - kw / 2, kw, kw); E.cream.style.clipPath = `inset(0 ${(100 - wipe * 100).toFixed(2)}% 0 0)`; }
    // pyramid: rides in the card until 2.933 s, then keeps its own size while the cream shrinks around it
    let pcx, pcy, pw;
    if (t < 2.933) { const w0 = t < 2.0 ? cw : kw; pcx = t < 2.0 ? ccx : kx; pcy = (t < 2.0 ? ccy : ky) + 7 * w0 / 172; pw = 0.87 * w0; }
    else { const [py, pww] = PYR(tc); pcx = 640; pcy = py; pw = pww; }
    const ps = pw / 177, ph = 156 * ps;
    E.pyr.style.transform = `translate(${pcx - pw / 2}px,${pcy - ph / 2}px) scale(${ps.toFixed(4)})`;
    E.pyrTeal.style.opacity = t < 2.6 ? 1 : 0;
    E.pyrWhite.style.opacity = t >= 2.93 ? 1 : 0;
    if (creamOn) E.pyrBlack.style.transform = `translate(${pcx - pw / 2 - (kx - kw / 2)}px,${pcy - ph / 2 - (ky - kw / 2)}px) scale(${ps.toFixed(4)})`;
    // AB tabs above the card: they vanish left to right as the cream passes under them
    const absOn = t < 2.24; show(E.abs, absOn);
    if (absOn && NAT.abs) {
      const s = (cw * 0.93) / NAT.abs.w;
      E.abs.style.transform = `translate(${ccx - NAT.abs.w * s / 2}px,${ccy - cw / 2 - 50 * cw / 240 - 7}px) scale(${s.toFixed(4)})`;
      absTabs.forEach((e, i) => { e.style.visibility = wipe > (i * 0.24 + 0.12) ? 'hidden' : 'visible'; });
    }
    // brackets
    const brOn = t >= 2.37; show(E.bkL, brOn); show(E.bkR, brOn);
    if (brOn) {
      const [xl, xr, yt, yb] = BRK(tc); place(E.bkL, xl, yt, 12, yb - yt); place(E.bkR, xr - 12, yt, 12, yb - yt);
      const a = seg(t, 2.37, 2.4) * (1 - 0.45 * seg(t, 3.1, 3.4)); E.bkL.style.opacity = E.bkR.style.opacity = a.toFixed(2);
    }
    // glyph line (sweeps from dark to white with the text)
    const sw = t < 2.04 ? 0 : SWEEP(t);
    {
      const [gx, gy, gw] = TA(tc), s = gw / GA_W;
      E.tA.style.transform = `translate(${gx - gw / 2}px,${gy - 7 * s}px) scale(${s.toFixed(4)})`;
      gStops[0].setAttribute('offset', sw.toFixed(3)); gStops[1].setAttribute('offset', Math.min(1, sw + 0.001).toFixed(3));
    }
    // STRONGHOLD PROTOCOL
    if (NAT.tB) {
      const [bx, btop, bw] = TB(tc), s = bw / NAT.tB.w, capTopInBox = 0.2 * 40;
      const sx = s * 1.038, sy = s * 1.29;
      E.tB.style.transform = `translate(${bx - bw * 1.038 / 2}px,${btop - capTopInBox * sy}px) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
      E.tBpale.style.clipPath = `inset(0 ${(100 - sw * 100).toFixed(2)}% 0 0)`;
      E.tBink.style.opacity = t < 2.36 ? 1 : 0;
    }
    // ALLIANCE + its dots
    const cOn = t >= 1.995; show(E.tC, cOn);
    if (cOn && NAT.tC) {
      const [ax, ay, aw] = TC(tc), s = aw / NAT.tC.w;
      const sy = s * 1.3;
      E.tC.style.transform = `translate(${ax - aw / 2}px,${ay - NAT.tC.h * sy / 2}px) scale(${s.toFixed(4)},${sy.toFixed(4)})`;
      const n = Math.round(REVEAL(t) * 8), half = Math.ceil(n / 2);
      tcLetters.forEach((e, i) => { e.style.visibility = (i >= 4 - Math.min(4, half) && i < 4 + Math.min(4, n - half)) ? 'visible' : 'hidden'; });
      const dA = seg(t, 2.03, 2.05) * (1 - seg(t, 3.0, 3.067));
      [[E.dotL, -1], [E.dotR, 1]].forEach(([d, sg]) => {
        show(d, dA > 0);
        const dx = ax + sg * (aw / 2 + 18 * aw / 144) - 3.5 * aw / 144, ds = aw / 144;
        d.style.transform = `translate(${dx}px,${ay - 8 * ds}px) scale(${ds.toFixed(3)})`; d.style.opacity = dA.toFixed(2);
      });
    }
    // the small block (fades out at the hand-off)
    const dOn = t < 3.075; show(E.blk, dOn);
    if (dOn && NAT.blk) {
      const [dx, dy, dw] = TD(tc), s = dw / NAT.blk.w;
      E.blk.style.transform = `translate(${dx - dw / 2}px,${dy - NAT.blk.h * s / 2}px) scale(${s.toFixed(4)})`;
      E.blk.style.color = t < 2.04 ? '#161c1f' : '#dedede'; E.blk.style.opacity = (1 - seg(t, 3.035, 3.07)).toFixed(2);
    }
    // 卫戍协议: 盟约
    const eOn = t >= 3.08; show(E.tE, eOn);
    if (eOn && NAT.tE) {
      // scaled like the Chinese line of the film (its width is the measured one), centred whatever its length
      const [ex, ey, ew] = TE(tc), s = ew / (NAT.tEref?.w || NAT.tE.w), w = NAT.tE.w * s;
      E.tE.style.transform = `translate(${ex - w / 2}px,${ey - NAT.tE.h * s / 2}px) scale(${s.toFixed(4)})`;
      E.tE.style.opacity = seg(t, 3.08, 3.17).toFixed(2);
    }
  }

  function render(T) {
    const introOn = T < 3.16; show(E.intro, introOn);
    if (introOn) intro(T);
    E.intro.style.opacity = (1 - seg(T, 3.0, 3.12)).toFixed(3);
    E.lobby.style.opacity = (1 - (1 - seg(T, 3.05, 3.37)) ** 1.6).toFixed(3); // the video's lobby eases in over 3.05-3.37 s
    const LS = T > 3.0 ? lobbyFrame(E, Math.max(0, T - 3.12)) : null;
    logo(T);
    // the title turns black over the dusk (the video's title does the same)
    E.logo.style.filter = LS && LS.dark > 0 ? `brightness(${(1 - LS.dark).toFixed(3)})` : '';
  }
  measure();
  return {
    stage, render, grain, measure,
    destroy() { removeEventListener('resize', fit); stage.remove(); },
  };
}

/**
 * The night / dusk cycle as a backdrop layer (the title screen and the lobby): still on the night under reduced motion.
 * Renders nothing without the art pack (hasSprites(LOBBY_SPRITES) — the caller keeps its own fallback).
 */
export function AllianceBackdrop({ class: cls = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    let ctl = null;
    try { ctl = mountAllianceBackdrop(ref.current, { motion: !reducedMotion() }); } catch (err) { console.warn('[alliance] backdrop failed', err); }
    return () => ctl?.destroy();
  }, []);
  return html`<div ref=${ref} class=${`spa-backdrop ${cls}`} aria-hidden="true" style="position:absolute;inset:0;overflow:hidden"></div>`;
}
