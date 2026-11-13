// Official theme prefabs drawn in the DOM. ui/prefab/layout.js lays a prefab out in its own units; one unit is drawn
// as 0.01rem times `scale` (1rem is 1/19.2 of a 16:9 width, ui-size; the official canvas is ~1334 units wide, so the
// official size is scale 1.44 — css/screens/game-reghud.css). Each node is a box nested in its parent's box (alpha,
// local scale / z rotation and RectMask2D clips reach the children, as in Unity); its Image or Text is a separate
// layer under the children, so a graphic's colour alpha stays its own.
//
// Images: simple (stretched, or contained with preserveAspect), sliced (border-image, fillCenter), tiled, filled
// (horizontal / vertical clip, radial with a conic mask); a white or coloured sprite under a colour is tinted through its
// own alpha mask (multiply), a sprite-less Image is a flat colour quad, an external (material) sprite is left out.
// Texts: TextAnchor 0–8, best fit inside the rect, the official font names on our faces, the pack's bitmap number
// fonts glyph by glyph. Particle holders are not drawn. Looping tweens (alpha, rotation, anchored position, size)
// become CSS animations, which stop under prefers-reduced-motion and the 主题动画 setting.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../components.js';
import { officialAssetUrl, officialThemeById } from '../../../../shared/uiTheme.js';
import { layoutPrefab, applySliders } from './layout.js';
import { createPose, applyStatuses, clipPose } from './anim.js';
import { parseHex, mixColor } from './color.js';
import { runClips } from './player.js';
import { mountThemeCharacter } from '../themeCharacter.js';

const CJK = "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', sans-serif";
/** Official dynamic fonts → our faces and weights (public/fonts: Bender, Novecento Wide; the CJK system faces). */
const FONT_FACES = Object.freeze({
  'Novecentowide-Normal': ["'Novecento Wide', 'Bender', " + CJK, 400],
  'Novecentowide-Medium': ["'Novecento Wide', 'Bender', " + CJK, 500],
  'Novecentowide-Bold': ["'Novecento Wide', 'Bender', " + CJK, 700],
  'NotoSansHans-Medium': [CJK, 500],
  'SourceHanSansCN-Bold': [CJK, 700],
  'SourceHanSansCN-Heavy': [CJK, 900],
});

/** @param {string|null|undefined} name */
export function fontFace(name) {
  return FONT_FACES[name] || [CJK, 500];
}

// DOTween's Ease ids (the client's tween components store them) as CSS timing functions; [ASSUMED] that enum.
const EASE = Object.freeze({
  1: 'linear',
  2: 'cubic-bezier(.12,0,.39,0)', 3: 'cubic-bezier(.61,1,.88,1)', 4: 'cubic-bezier(.37,0,.63,1)',
  5: 'cubic-bezier(.11,0,.5,0)', 6: 'cubic-bezier(.5,1,.89,1)', 7: 'cubic-bezier(.45,0,.55,1)',
  8: 'cubic-bezier(.32,0,.67,0)', 9: 'cubic-bezier(.33,1,.68,1)', 10: 'cubic-bezier(.65,0,.35,1)',
});

/** @param {any} v @param {number} d */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
/** Units → rem text. @param {number} u */
const rem = (u) => `${Number((u / 100).toFixed(4))}rem`;

export { parseHex, mixColor };

const measureCache = new Map();
let measureCtx = null;

/**
 * Text width in units at the node's font size (canvas 2D; a rough estimate without a canvas, e.g. under node:test).
 * @param {string} text @param {any} node @param {any} [fonts]
 */
export function measureText(text, node, fonts = null) {
  const size = num(node?.text?.fontSize, 14);
  const bitmap = fonts?.[node?.text?.font];
  if (bitmap) {
    let w = 0;
    for (const ch of String(text)) w += num(bitmap.glyphs.get(ch.codePointAt(0))?.advance, size * 0.5);
    return { w, h: bitmap.lineH };
  }
  const [family, weight] = fontFace(node?.text?.font);
  const key = `${weight}|${size}|${family}|${text}`;
  const hit = measureCache.get(key);
  if (hit) return hit;
  let w = String(text).length * size * 0.6;
  try {
    if (!measureCtx && typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = `${weight} ${size}px ${family}`;
      w = measureCtx.measureText(String(text)).width;
    }
  } catch { /* the estimate stays */ }
  const out = { w, h: size * 1.2 };
  if (measureCache.size > 2000) measureCache.clear();
  measureCache.set(key, out);
  return out;
}

const packCache = new Map();

/**
 * The installed official pack's prefabs.json (tools/local-extract), loaded once per pack. Null for the default pack
 * (ac_n_initial keeps the hand-made HUD), a custom theme, or a pack without the file (an older asset pack).
 * @param {Record<string, any>|null|undefined} groups  data.get('local').groups
 * @param {string|null|undefined} themeId  settings.uiTheme
 * @param {{ includeDefault?: boolean }} [opts]  includeDefault: ac_n_initial too (the dev prefab lab)
 */
export function prefabPackUrl(groups, themeId, opts = {}) {
  const theme = officialThemeById(themeId);
  if (!theme?.group || (theme.group === 'themes/ac_n_initial' && !opts.includeDefault)) return null;
  const entry = groups?.[theme.group]?.['prefabs.json'];
  return entry ? officialAssetUrl(theme.group, entry) || null : null;
}

/**
 * @param {Record<string, any>|null|undefined} groups @param {string|null|undefined} themeId @param {{ includeDefault?: boolean }} [opts]
 * @returns {{ group: string, doc: any, fonts: Record<string, any>, sprite: (name: string|null|undefined, file?: string|null) => string } | null}
 */
export function usePrefabPack(groups, themeId, opts = {}) {
  const url = prefabPackUrl(groups, themeId, opts);
  const group = officialThemeById(themeId)?.group || '';
  const [doc, setDoc] = useState(() => (url && packCache.get(url)?.doc) || null);
  useEffect(() => {
    if (!url) { setDoc(null); return undefined; }
    let live = true;
    let entry = packCache.get(url);
    if (!entry) {
      entry = { doc: null, promise: fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null) };
      packCache.set(url, entry);
      entry.promise.then((d) => { entry.doc = d && d.spPrefabs === 1 && d.prefabs ? d : null; });
    }
    if (entry.doc) setDoc(entry.doc);
    else entry.promise.then(() => { if (live) setDoc(entry.doc); });
    return () => { live = false; };
  }, [url]);
  return useMemo(() => (url && doc ? makePack(groups, group, doc) : null), [url, doc, groups, group]);
}

/** @param {any} groups @param {string} group @param {any} doc */
export function makePack(groups, group, doc) {
  /** An image's file: the extractor's own (same-name sprites, prefabs.json image.file), else sprites/<name>.webp. */
  const sprite = (name, file = null) => {
    if (!name) return '';
    const entry = (file && groups?.[group]?.[file]) || groups?.[group]?.[`sprites/${name}.webp`];
    return entry ? officialAssetUrl(group, entry) || '' : '';
  };
  /** An effect material's texture (prefabs.json `textures`: sprites/tex_<name>.webp, or the sprite of that name). */
  const texture = (name) => {
    const rec = name ? doc?.textures?.[name] : null;
    const entry = rec?.file ? groups?.[group]?.[rec.file] : null;
    return entry ? officialAssetUrl(group, entry) || '' : '';
  };
  /** @type {Record<string, any>} */
  const fonts = {};
  for (const f of Array.isArray(doc?.fonts) ? doc.fonts : []) {
    if (!f?.name || !Array.isArray(f.glyphs) || !f.glyphs.length || !f.file) continue;
    const entry = groups?.[group]?.[f.file];
    const url = entry ? officialAssetUrl(group, entry) : '';
    if (!url) continue;
    const glyphs = new Map(f.glyphs.map((g) => [g.char, g]));
    const lineH = Math.max(...f.glyphs.map((g) => Math.abs(num(g.vert?.[3]))));
    fonts[f.name] = { url, w: num(f.w, 1), h: num(f.h, 1), glyphs, lineH };
  }
  return { group, doc, fonts, sprite, texture };
}

/**
 * Inline style of a node's image layer; null when it is not drawn: an external sprite, or a sprite-less Image with a
 * material of its own (a shader effect: dissolve, flow, masks — [ASSUMED] left out until the effects are drawn).
 * @param {any} img @param {(name: string, file?: string|null) => string} sprite @param {any} [over]  pose colour channels
 * @param {number|null} [fillAmount] @param {((name: string) => string)|null} [texture]  effect material textures
 */
export function imageStyle(img, sprite, over = null, fillAmount = null, texture = null) {
  if (!img.sprite && img.material?.base && texture) return effectStyle(img, over, texture);
  const [r, g, b, a] = mixColor(img.color, over);
  const tint = !(r === 255 && g === 255 && b === 255);
  const color = `rgb(${r} ${g} ${b})`;
  /** @type {Record<string, string>} */
  const st = {};
  if (a <= 0) return null;
  if (a < 1) st.opacity = String(Number(a.toFixed(3)));
  if (!img.sprite) {
    if (img.external || img.material) return null;
    st.backgroundColor = color;
    return st;
  }
  // an additive material (m_add): [ASSUMED] screen blending is near enough over the dark HUD
  if (/(^|_)add(_|$)/i.test(img.material?.name || '')) st.mixBlendMode = 'screen';
  const url = sprite(img.sprite, img.file);
  if (!url) return null;
  const src = `url("${url}")`;
  const ppu = num(img.ppu, 1) || 1;
  if (img.type === 'sliced' && Array.isArray(img.slice)) {
    const sl = img.slice.map((v) => num(v));
    const widths = sl.map((v) => rem(v / ppu)).join(' ');
    const fill = img.fillCenter === 0 ? '' : ' fill';
    if (tint) {
      st.backgroundColor = color;
      st.WebkitMaskBoxImage = `${src} ${sl.join(' ')}${fill} / ${widths} stretch`;
      st.maskBorder = `${src} ${sl.join(' ')}${fill} / ${widths} stretch`;
    } else {
      st.borderStyle = 'solid';
      st.borderWidth = widths;
      st.borderImage = `${src} ${sl.join(' ')}${fill} / ${widths} stretch`;
    }
    return st;
  }
  const size = img.type === 'tiled' ? `${rem(num(img.w) / ppu)} ${rem(num(img.h) / ppu)}` : img.preserve ? 'contain' : '100% 100%';
  const repeat = img.type === 'tiled' ? 'repeat' : 'no-repeat';
  if (tint) {
    st.backgroundColor = color;
    st.backgroundImage = src;
    st.backgroundBlendMode = 'multiply';
    st.backgroundSize = size;
    st.backgroundRepeat = repeat;
    st.backgroundPosition = 'center';
    st.WebkitMaskImage = src;
    st.maskImage = src;
    st.WebkitMaskSize = size;
    st.maskSize = size;
    st.WebkitMaskRepeat = repeat;
    st.maskRepeat = repeat;
    st.WebkitMaskPosition = 'center';
    st.maskPosition = 'center';
  } else {
    st.backgroundImage = src;
    st.backgroundSize = size;
    st.backgroundRepeat = repeat;
    st.backgroundPosition = 'center';
  }
  if (img.type === 'filled') {
    const amount = Math.min(1, Math.max(0, num(fillAmount ?? img.fillAmount, 1)));
    const method = num(img.fillMethod);
    const origin = num(img.fillOrigin);
    if (method === 0) st.clipPath = origin === 1 ? `inset(0 0 0 ${(1 - amount) * 100}%)` : `inset(0 ${(1 - amount) * 100}% 0 0)`;
    else if (method === 1) st.clipPath = origin === 1 ? `inset(0 0 ${(1 - amount) * 100}% 0)` : `inset(${(1 - amount) * 100}% 0 0 0)`;
    else if (method === 4) {
      const cone = `conic-gradient(from 0deg, #000 ${amount * 360}deg, transparent 0)`;
      st.WebkitMaskImage = st.WebkitMaskImage ? `${st.WebkitMaskImage}, ${cone}` : cone;
      st.maskImage = st.WebkitMaskImage;
    }
  }
  return st;
}

/** Stop animations. @param {Animation[]} anims */
function cancelAll(anims) {
  for (const a of anims) { try { a.cancel(); } catch { /* gone */ } }
}

/** A status driver entry by name anywhere under the prefab. @param {any} root @param {string} name */
function statusEntry(root, name) {
  let hit = null;
  (function walk(n) {
    if (hit || !n) return;
    const e = Array.isArray(n.status) ? n.status.find((x) => x?.name === name) : null;
    if (e) { hit = e; return; }
    for (const c of n.children || []) walk(c);
  })(root);
  return hit;
}

/**
 * What a clip run needs on the drawn prefab: node → element, node → what the layout drew, the clips, the id index.
 * Null while still, under reduced motion, or before the first drawing.
 */
function playContext(root, laid, prefab, pack, still) {
  if (!laid || !root || still || reducedMotionNow()) return null;
  const idx = nodeIndex(prefab);
  const refs = drawnRefs(laid.box, laid.pose);
  const els = new Map();
  for (const el of root.querySelectorAll('[data-pi]')) els.set(Number(el.getAttribute('data-pi')), el);
  return {
    refs,
    clips: pack?.doc?.clips || {},
    ids: indexIds(prefab),
    // a loop runs only where it shows (an invisible layer's animation cannot go to the compositor); a one-shot clip
    // runs on every drawn layer, since it may be the one that fades a hidden group in
    elOfShown: (node) => (refs.get(node)?.shown !== false ? els.get(idx.get(node)) || null : null),
    elOf: (node) => els.get(idx.get(node)) || null,
    refOf: (node) => refs.get(node) || null,
  };
}

/** prefers-reduced-motion right now (no clip playback then). */
function reducedMotionNow() {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * A sprite-less Image drawn by the official effect shader: its base texture (tiled) × the Image colour × the material
 * tint, cut by the material's alpha mask, blended like light. [ASSUMED] the effect textures are light shapes drawn as a
 * colour through their alpha; dissolves and distortion are left out; the base's UV scroll is added by PNodeView (it
 * needs the box).
 * @param {any} img @param {any} over @param {(name: string) => string} texture
 */
export function effectStyle(img, over, texture) {
  const m = img.material;
  const base = texture(m.base);
  if (!base) return null;
  const [r, g, b, a] = mixColor(img.color, over);
  const [tr, tg, tb, ta] = parseHex(m.tint || '#FFFFFF');
  const alpha = a * ta;
  if (alpha <= 0) return null;
  const tile = Array.isArray(m.tile) ? m.tile.map((v) => num(v, 1) || 1) : [1, 1];
  const size = `${Number((100 / tile[0]).toFixed(3))}% ${Number((100 / tile[1]).toFixed(3))}%`;
  const mask = m.mask ? texture(m.mask) : '';
  const layers = mask ? `url("${base}"), url("${mask}")` : `url("${base}")`;
  /** @type {Record<string, string>} */
  const st = {
    backgroundColor: `rgb(${Math.round((r * tr) / 255)} ${Math.round((g * tg) / 255)} ${Math.round((b * tb) / 255)})`,
    WebkitMaskImage: layers, maskImage: layers,
    WebkitMaskSize: mask ? `${size}, 100% 100%` : size, maskSize: mask ? `${size}, 100% 100%` : size,
    WebkitMaskRepeat: mask ? 'repeat, no-repeat' : 'repeat', maskRepeat: mask ? 'repeat, no-repeat' : 'repeat',
    mixBlendMode: 'screen',
  };
  if (mask) { st.WebkitMaskComposite = 'source-in'; st.maskComposite = 'intersect'; }
  if (alpha < 1) st.opacity = String(Number(alpha.toFixed(3)));
  return st;
}

/** The base texture's UV scroll (units / s along u and v) as a mask-position loop on the box. @param {any} m @param {any} box */
export function effectScroll(m, box) {
  const speed = Array.isArray(m?.speed) ? m.speed.map((v) => num(v)) : null;
  if (!speed || (!speed[0] && !speed[1]) || !(box?.w > 0) || !(box?.h > 0)) return null;
  const tile = Array.isArray(m.tile) ? m.tile.map((v) => num(v, 1) || 1) : [1, 1];
  const tw = box.w / tile[0];
  const th = box.h / tile[1];
  const T = 1 / Math.max(Math.abs(speed[0]), Math.abs(speed[1]));
  const dx = -speed[0] * T * tw;
  const dy = speed[1] * T * th;
  const rest = m.mask ? ', 0 0' : '';
  const name = `pf-uv_${tok(dx)}_${tok(dy)}_${m.mask ? 'm' : 'n'}`;
  const body = `from { -webkit-mask-position: 0 0${rest}; mask-position: 0 0${rest}; } to { -webkit-mask-position: ${rem(dx)} ${rem(dy)}${rest}; mask-position: ${rem(dx)} ${rem(dy)}${rest}; }`;
  return { name, body, animation: `${name} ${Number(T.toFixed(3))}s linear infinite` };
}

const keyframesDone = new Set();
let keyframesSheet = null;

/**
 * One @keyframes rule with literal values, added once to a shared sheet. Literal keyframes (not var()) let the browser
 * run an opacity / transform animation without a style recalculation every frame.
 * @param {string} name @param {string} body
 */
function ensureKeyframes(name, body) {
  if (keyframesDone.has(name)) return;
  keyframesDone.add(name);
  try {
    if (typeof document === 'undefined') return;
    if (!keyframesSheet) {
      const el = document.createElement('style');
      el.id = 'pf-keyframes';
      document.head.appendChild(el);
      keyframesSheet = el.sheet;
    }
    keyframesSheet?.insertRule(`@keyframes ${name} { ${body} }`, keyframesSheet.cssRules.length);
  } catch { /* an unsupported property: the layer stays still */ }
}

/** A number as a keyframes-name token. @param {number} n */
const tok = (n) => String(Number(Number(n).toFixed(3))).replace('-', 'm').replace('.', 'p');

/**
 * CSS animation for a node's looping tweens (the first of each kind): opacity, or the individual translate / rotate /
 * scale properties, which compose with the node's static transform.
 * @param {any[]} tweens @param {any} box
 * @returns {{ animation: string, keyframes: [string, string][] } | null}
 */
export function tweenStyle(tweens, box) {
  if (!Array.isArray(tweens) || !tweens.length) return null;
  const anims = [];
  /** @type {[string, string][]} */
  const keyframes = [];
  const seen = new Set();
  for (const tw of tweens) {
    if (!tw || !tw.auto || seen.has(tw.kind)) continue;
    const dur = Math.max(0.05, num(tw.dur, 1));
    const iter = num(tw.loop) < 0 ? 'infinite' : String(Math.max(1, num(tw.loop, 1)));
    const dir = num(tw.loopType) === 1 ? 'alternate' : 'normal';
    const ease = EASE[num(tw.ease)] || 'ease-in-out';
    const delay = num(tw.delay) ? ` ${num(tw.delay)}s` : ' 0s';
    let name;
    let body;
    if (tw.kind === 'alpha') {
      const a = num(tw.from, 1);
      const b = num(tw.to, 1);
      name = `pf-a_${tok(a)}_${tok(b)}`;
      body = `from { opacity: ${a}; } to { opacity: ${b}; }`;
    } else if (tw.kind === 'rot' && Array.isArray(tw.from)) {
      const a = -num(tw.from[2]);
      const b = -num(tw.to?.[2]);
      name = `pf-r_${tok(a)}_${tok(b)}`;
      body = `from { rotate: ${a}deg; } to { rotate: ${b}deg; }`;
    } else if (tw.kind === 'pos' && Array.isArray(tw.from)) {
      const at = box?.node?.rect?.anchoredPosition || [0, 0];
      const x0 = num(tw.from[0]) - num(at[0]);
      const y0 = -(num(tw.from[1]) - num(at[1]));
      const x1 = num(tw.to?.[0]) - num(at[0]);
      const y1 = -(num(tw.to?.[1]) - num(at[1]));
      name = `pf-t_${tok(x0)}_${tok(y0)}_${tok(x1)}_${tok(y1)}`;
      body = `from { translate: ${rem(x0)} ${rem(y0)}; } to { translate: ${rem(x1)} ${rem(y1)}; }`;
    } else if (tw.kind === 'size' && Array.isArray(tw.from) && box?.w > 0 && box?.h > 0) {
      // [ASSUMED] drawn as a scale of the box (the width tween of an arrow strip): no relayout every frame
      const sx0 = num(tw.from[0]) / box.w;
      const sy0 = num(tw.from[1]) / box.h;
      const sx1 = num(tw.to?.[0]) / box.w;
      const sy1 = num(tw.to?.[1]) / box.h;
      name = `pf-s_${tok(sx0)}_${tok(sy0)}_${tok(sx1)}_${tok(sy1)}`;
      body = `from { scale: ${sx0} ${sy0}; } to { scale: ${sx1} ${sy1}; }`;
    } else {
      continue;
    }
    seen.add(tw.kind);
    keyframes.push([name, body]);
    anims.push(`${name} ${dur}s ${ease}${delay} ${iter} ${dir} both`);
  }
  if (!anims.length) return null;
  return { animation: anims.join(', '), keyframes };
}

/** A SkeletonGraphic's place: the theme's UI Spine, idle (a voice-less copy of the funds card's character). */
function SpineSlot({ character }) {
  const ref = useRef(null);
  const key = character?.spine?.skel || character?.imageUrl || '';
  useEffect(() => {
    if (!ref.current || !key) return undefined;
    return mountThemeCharacter(ref.current, character, { voice: false });
  }, [key]);
  return html`<i class="pf__spine" ref=${ref} aria-hidden="true"></i>`;
}

/** Bitmap-font text: one sprite per glyph. @param {{ text: string, font: any, align: number }} props */
function BitmapText({ text, font, align }) {
  const chars = [...String(text)];
  const row = Math.floor(align / 3);
  const col = align % 3;
  return html`<span class="pf__btext" style=${{
    justifyContent: col === 0 ? 'flex-start' : col === 2 ? 'flex-end' : 'center',
    alignItems: row === 0 ? 'flex-start' : row === 2 ? 'flex-end' : 'center',
  }}>${chars.map((ch, i) => {
    const g = font.glyphs.get(ch.codePointAt(0));
    if (!g) return html`<span key=${i} class="pf__glyph" style=${{ width: rem(font.lineH * 0.5) }}></span>`;
    const [ux, uy, uw, uh] = g.uv;
    const gw = Math.abs(num(g.vert?.[2]));
    const gh = Math.abs(num(g.vert?.[3]));
    // uv is from the texture's bottom-left; the glyph quad is gw × gh units, the whole texture (1/uw) × (1/uh) quads
    const tw = uw ? gw / uw : gw;
    const th = uh ? gh / uh : gh;
    return html`<span key=${i} class="pf__glyph" style=${{
      width: rem(num(g.advance, gw)), height: rem(gh),
      backgroundImage: `url("${font.url}")`,
      backgroundSize: `${rem(tw)} ${rem(th)}`,
      backgroundPosition: `${rem(-ux * tw)} ${rem(-(1 - uy - uh) * th)}`,
    }}></span>`;
  })}</span>`;
}

/** @param {{ box: any, pack: any, fit: Map<any, number>, pose: any, idx: Map<any, number>, spine?: any }} props */
function PNodeView({ box, pack, fit, pose, idx, spine = null }) {
  const n = box.node;
  // a tween under a hidden group (alpha 0: the countdown's spare pictures) does not run: the browser cannot hand an
  // invisible layer's animation to the compositor and would restyle it every frame
  const tw = box.shown ? tweenStyle(n.tweens, box) : null;
  if (tw) for (const [name, body] of tw.keyframes) ensureKeyframes(name, body);
  const alphaTween = !!tw && tw.animation.includes('pf-a_');
  /** @type {Record<string, string>} */
  const style = { left: rem(box.left), top: rem(box.top), width: rem(box.w), height: rem(box.h) };
  if (box.alpha < 1 && !alphaTween) style.opacity = String(Number(box.alpha.toFixed(3)));
  const tf = [];
  const rot = pose?.rot.has(n) ? pose.rot.get(n) : n.rot;
  const scl = pose?.scale.get(n) || n.scale;
  if (rot) tf.push(`rotate(${-num(rot)}deg)`);
  if (Array.isArray(scl) && (num(scl[0], 1) !== 1 || num(scl[1], 1) !== 1)) tf.push(`scale(${num(scl[0], 1)}, ${num(scl[1], 1)})`);
  if (tf.length) {
    style.transform = tf.join(' ');
    style.transformOrigin = `${box.pivot[0] * 100}% ${(1 - box.pivot[1]) * 100}%`;
  }
  if (tw) {
    style.animation = tw.animation;
    if (!style.transformOrigin) style.transformOrigin = `${box.pivot[0] * 100}% ${(1 - box.pivot[1]) * 100}%`;
  }
  if (n.mask?.rect) {
    style.overflow = 'hidden';
    const soft = Array.isArray(n.mask.soft) ? n.mask.soft : null;
    if (soft && (soft[0] > 0 || soft[1] > 0) && box.w > 0 && box.h > 0) {
      const fx = Math.min(50, (num(soft[0]) / box.w) * 100);
      const fy = Math.min(50, (num(soft[1]) / box.h) * 100);
      const grads = [];
      if (fx > 0) grads.push(`linear-gradient(90deg, transparent, #000 ${fx}%, #000 ${100 - fx}%, transparent)`);
      if (fy > 0) grads.push(`linear-gradient(180deg, transparent, #000 ${fy}%, #000 ${100 - fy}%, transparent)`);
      style.WebkitMaskImage = grads.join(', ');
      style.maskImage = grads.join(', ');
      if (grads.length > 1) { style.WebkitMaskComposite = 'source-in'; style.maskComposite = 'intersect'; }
    }
  }
  let graphic = null;
  if (n.image) {
    const st = imageStyle(n.image, pack.sprite, pose?.color.get(n), pose?.fill.get(n), pack.texture);
    const scroll = st && !n.image.sprite && n.image.material?.base && box.shown ? effectScroll(n.image.material, box) : null;
    if (scroll) { ensureKeyframes(scroll.name, scroll.body); st.animation = scroll.animation; }
    if (st) graphic = html`<i class=${scroll ? 'pf__g pf__fx' : 'pf__g'} style=${st}></i>`;
  } else if (n.text && box.text != null && box.text !== '') {
    const t = n.text;
    const align = num(t.align);
    const bitmap = pack.fonts[t.font];
    const [r, g, b, a] = mixColor(t.color, pose?.color.get(n));
    if (bitmap) {
      graphic = html`<i class="pf__g pf__t" style=${{ opacity: a < 1 ? String(a) : undefined }}><${BitmapText} text=${box.text} font=${bitmap} align=${align} /></i>`;
    } else {
      const [family, weight] = fontFace(t.font);
      const size = fit.get(n) ?? num(t.fontSize, 14);
      const row = Math.floor(align / 3);
      const col = align % 3;
      graphic = html`<i class="pf__g pf__t" style=${{
        color: `rgb(${r} ${g} ${b} / ${a})`, fontFamily: family, fontWeight: String(weight), fontSize: rem(size),
        fontStyle: t.style === 2 || t.style === 3 ? 'italic' : undefined,
        justifyContent: col === 0 ? 'flex-start' : col === 2 ? 'flex-end' : 'center',
        alignItems: row === 0 ? 'flex-start' : row === 2 ? 'flex-end' : 'center',
        textAlign: col === 0 ? 'left' : col === 2 ? 'right' : 'center',
      }}>${box.text}</i>`;
    }
  }
  return html`<div class="pf__n" data-n=${n.name} data-pi=${idx.get(n)} style=${style}>
    ${graphic}
    ${n.spine && spine ? html`<${SpineSlot} character=${spine} />` : null}
    ${box.children.map((c, i) => html`<${PNodeView} key=${i} box=${c} pack=${pack} fit=${fit} pose=${pose} idx=${idx} spine=${spine} />`)}
  </div>`;
}

/** Best-fit font sizes for the laid-out texts (Unity shrinks between minSize and maxSize until the text fits). */
function bestFit(box, pack, out = new Map()) {
  const n = box.node;
  if (n.text?.bestFit && box.text && !pack.fonts[n.text.font]) {
    const max = num(n.text.maxSize, num(n.text.fontSize, 14));
    const min = Math.max(1, num(n.text.minSize, 1));
    const probe = { ...n, text: { ...n.text, fontSize: max } };
    const m = measureText(box.text, probe, pack.fonts);
    let size = max;
    if (m.w > box.w && box.w > 0) size = Math.max(min, Math.floor((max * box.w) / m.w));
    if (box.h > 0) size = Math.max(min, Math.min(size, Math.floor(box.h / 1.15)));
    out.set(n, size);
  }
  for (const c of box.children) bestFit(c, pack, out);
  return out;
}

const nodeIndexes = new WeakMap();

/** Node → its tree-order index (the box element's data-pi), cached per prefab. @param {any} root */
export function nodeIndex(root) {
  let map = nodeIndexes.get(root);
  if (!map) {
    map = new Map();
    let i = 0;
    (function walk(n) {
      map.set(n, i++);
      for (const c of n?.children || []) walk(c);
    })(root);
    nodeIndexes.set(root, map);
  }
  return map;
}

/** What the layout drew for each node, for the clip player: anchored position, size, scale, rotation, colour. */
function drawnRefs(box, pose, out = new Map()) {
  const n = box.node;
  const rect = n.rect || {};
  const base = Array.isArray(rect.anchoredPosition) ? rect.anchoredPosition : [0, 0];
  const pos = pose?.pos.get(n);
  const color = n.image?.color || n.text?.color || null;
  const [r, g, b] = mixColor(color, pose?.color.get(n));
  out.set(n, {
    pos: [pos?.[0] ?? (Number(base[0]) || 0), pos?.[1] ?? (Number(base[1]) || 0)],
    size: [box.w, box.h],
    scale: pose?.scale.get(n) || (Array.isArray(n.scale) ? [Number(n.scale[0]) || 1, Number(n.scale[1]) || 1] : [1, 1]),
    rot: pose?.rot.has(n) ? pose.rot.get(n) : Number(n.rot) || 0,
    alpha: box.alpha,
    color,
    tinted: !!n.image && !(r === 255 && g === 255 && b === 255),
    text: !!n.text,
    shown: box.shown && box.alpha > 0,
  });
  for (const c of box.children) drawnRefs(c, pose, out);
  return out;
}

/** Node id → node. @param {any} root */
export function indexIds(root) {
  const out = new Map();
  (function walk(n) {
    if (Number.isInteger(n?.id)) out.set(n.id, n);
    for (const c of n?.children || []) walk(c);
  })(root);
  return out;
}

/**
 * The pose a prefab is drawn in: its statuses (active ops, then each clip's end), then the id-keyed overrides.
 * @param {any} pack @param {any} prefab
 * @param {{ status?: string[]|null, texts?: Map<number, string|null>|null, active?: Map<number, boolean>|null,
 *   alpha?: Map<number, number>|null, sliders?: Map<number, number>|null }} binds
 */
export function buildPose(pack, prefab, { status = null, texts = null, active = null, alpha = null, sliders = null, textFor = null, poses = null, fills = null, hide = null } = {}) {
  const pose = createPose();
  const ids = indexIds(prefab);
  const clips = pack?.doc?.clips || {};
  applyStatuses(prefab, clips, status || [], pose, (id) => ids.get(id) || null);
  // a controller's own clip (the ready button's btn_ready_switch): at its end, its start, or a time
  for (const p of poses || []) {
    const clip = clips[p?.clip];
    if (!clip) continue;
    const on = (Number.isInteger(p.on) ? ids.get(p.on) : null) || prefab;
    clipPose(clip, on, p.at === 'start' ? 0 : p.at === 'end' || p.at == null ? Number(clip.len) || 0 : Number(p.at) || 0, pose);
  }
  for (const [map, into] of [[active, pose.active], [alpha, pose.alpha], [texts, pose.texts], [fills, pose.fill]]) {
    if (!map) continue;
    for (const [id, v] of map) {
      const n = ids.get(id);
      if (n) into.set(n, v);
    }
  }
  if (sliders) applySliders(prefab, sliders, pose);
  if (hide?.length) {
    (function walk(n) {
      if (hide.includes(n?.name)) pose.active.set(n, false);
      for (const c of n?.children || []) walk(c);
    })(prefab);
  }
  if (textFor) {
    (function walk(n) {
      if (n?.text && !pose.texts.has(n)) {
        const v = textFor(n);
        if (v != null) pose.texts.set(n, v);
      }
      for (const c of n?.children || []) walk(c);
    })(prefab);
  }
  return pose;
}

/**
 * One prefab, laid out and drawn. The container is the union of the drawn boxes (a zero-size root is a point), scaled.
 * @param {{ pack: any, prefab: any, texts?: Map<number, string|null>|null, status?: string[]|null,
 *   active?: Map<number, boolean>|null, alpha?: Map<number, number>|null, sliders?: Map<number, number>|null,
 *   scale?: number, className?: string, still?: boolean, label?: string|null, textFor?: ((node: any) => string|null)|null,
 *   poses?: { on?: number|null, clip: string, at?: 'start'|'end'|number }[]|null, fills?: Map<number, number>|null,
 *   hide?: string[]|null, play?: { clip: string, on?: number|null, reverse?: boolean, delay?: number, rate?: number }[]|null,
 *   playKey?: string|number|null, auto?: boolean, spine?: any }} props  hide: node names drawn inactive; spine: the
 *   theme character (theme.json `character`) drawn where the prefab has a SkeletonGraphic
 *   play: clips run once when playKey changes (a status transition, a banner's in / out); auto: each drawn node's
 *   PlayAutomatically clip loops (ui/prefab/player.js). Neither runs while still or under reduced motion.
 *   The box is the root's rect when it has a size (what overflows it, a long shadow, is drawn outside), else the union
 *   of the drawn boxes.
 *   texts: node id → string (null hides the text); status: status driver names applied in order; active / alpha: extra
 *   overrides after the statuses; sliders: slider node id → value; still: no tween animations
 */
export function PrefabView({ pack, prefab, texts = null, status = null, active = null, alpha = null, sliders = null,
  scale = 1, className = '', still = false, label = null, textFor = null, poses = null, fills = null, hide = null,
  play = null, playKey = null, auto = true, spine = null }) {
  const rootRef = useRef(null);
  const statusKey = (status || []).join('|');
  const posesKey = (poses || []).map((p) => `${p.on}:${p.clip}:${p.at}`).join('|');
  const laid = useMemo(() => {
    if (!pack || !prefab) return null;
    const pose = buildPose(pack, prefab, { status, texts, active, alpha, sliders, textFor, poses, fills, hide });
    const opts = { pose, measure: (text, node) => measureText(text, node, pack.fonts), skip: (node) => !!node.fx };
    const out = layoutPrefab(prefab, opts);
    const own = out.box.w > 0 && out.box.h > 0;
    const frame = own ? { left: out.box.left, top: out.box.top, w: out.box.w, h: out.box.h } : out.bounds;
    return { ...out, bounds: frame, pose, fit: bestFit(out.box, pack) };
  }, [pack, prefab, texts, statusKey, posesKey, active, alpha, sliders, textFor, fills, (hide || []).join('|')]);
  const laidRef = useRef(null);
  laidRef.current = laid;
  const prevStatus = useRef(/** @type {string[]|null} */ (null));
  const hideKey = (hide || []).join('|');
  // the drawn nodes' own loops: restarted when the statuses (which nodes are drawn) change, not on a text change
  useLayoutEffect(() => {
    const ctx = playContext(rootRef.current, laidRef.current, prefab, pack, still);
    if (!ctx || !auto) return undefined;
    const jobs = [];
    for (const [node, ref] of ctx.refs) {
      if (!node.autoClip || !ref.shown) continue;
      const clip = ctx.clips[node.autoClip];
      if (clip) jobs.push({ clip, on: node, loop: clip.wrap === 2 || clip.wrap === 4 });
    }
    const anims = jobs.length ? runClips(jobs, ctx.elOfShown, ctx.refOf) : [];
    return () => cancelAll(anims);
  }, [prefab, pack, statusKey, posesKey, hideKey, still, auto]);
  // once: a status entered since the last drawing plays its clips (a switch clip shown backwards in reverse; a fast op
  // is already at its end), and each `play` request when playKey changes
  useLayoutEffect(() => {
    const before = prevStatus.current;
    prevStatus.current = status ? [...status] : [];
    const ctx = playContext(rootRef.current, laidRef.current, prefab, pack, still);
    if (!ctx) return undefined;
    const jobs = [];
    if (before) {
      for (const name of status || []) {
        if (before.includes(name)) continue;
        for (const op of statusEntry(prefab, name)?.ops || []) {
          if (!op.anim?.clip || op.fast) continue;
          const clip = ctx.clips[op.anim.clip];
          if (clip) jobs.push({ clip, on: (Number.isInteger(op.anim.on) ? ctx.ids.get(op.anim.on) : null) || prefab, reverse: op.t === 3 && !op.show });
        }
      }
    }
    for (const p of play || []) {
      const clip = ctx.clips[p?.clip];
      if (clip) jobs.push({ clip, on: (Number.isInteger(p.on) ? ctx.ids.get(p.on) : null) || prefab, reverse: !!p.reverse, delay: p.delay || 0, rate: p.rate || 1 });
    }
    const anims = jobs.length ? runClips(jobs, ctx.elOf, ctx.refOf) : [];
    return () => cancelAll(anims);
  }, [prefab, pack, statusKey, playKey, still]);
  if (!laid) return null;
  const { box, bounds, fit, pose } = laid;
  const idx = nodeIndex(prefab);
  return html`<div class=${`pf ${still ? 'pf--still' : ''} ${className}`.trim()} role=${label ? 'img' : undefined} aria-label=${label || undefined}
      aria-hidden=${label ? undefined : 'true'} style=${{ '--pf-k': String(scale), width: rem(bounds.w * scale), height: rem(bounds.h * scale) }}>
    <div class="pf__stage" style=${{ width: rem(bounds.w), height: rem(bounds.h), transform: `scale(${scale})` }}>
      <div class="pf__root" ref=${rootRef} style=${{ left: rem(-bounds.left), top: rem(-bounds.top) }}>
        <${PNodeView} box=${box} pack=${pack} fit=${fit} pose=${pose} idx=${idx} spine=${spine} />
      </div>
    </div>
  </div>`;
}
