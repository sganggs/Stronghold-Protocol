import { audio } from '../audio.js';
// Lobby hub backdrop (owner's request, 2026-10-13): original procedural scenes without a sun — 夜巡 (default), 霜原,
// 烬野, 静默 — or the player's own picture. A picture is downscaled on this device and kept in IndexedDB (never
// uploaded); the choice and its dim / blur / overlay / motion settings are a localStorage pref. The ridges and the
// stronghold silhouette are generated from fixed seeds, so every visit draws the same skyline.
import { html } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { loadPref, savePref } from '../store.js';
import { toast } from './toasts.js';

export const HUB_THEMES = [
  { id: 'night', name: '夜巡', en: 'NIGHT WATCH' },
  { id: 'frost', name: '霜原', en: 'FROSTLINE' },
  { id: 'ember', name: '烬野', en: 'EMBERFIELD' },
  { id: 'calm', name: '静默', en: 'SILENT' },
];
const THEME_IDS = HUB_THEMES.map((x) => x.id);
const PREF_KEY = 'hub.backdrop';
const MAX_EDGE = 2560; // longest edge kept of a custom picture
const MAX_FILE = 30 * 1024 * 1024;

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The saved backdrop choice, sanitised. */
export function loadBackdropPref() {
  const raw = loadPref(PREF_KEY, null);
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    theme: THEME_IDS.includes(o.theme) || o.theme === 'custom' ? o.theme : 'night',
    dim: clamp(num(o.dim, 45), 0, 85),
    blur: clamp(num(o.blur, 0), 0, 16),
    overlay: o.overlay !== false,
    motion: o.motion !== false,
    videoSound: o.videoSound === true,videoPaused: o.videoPaused === true,
  };
}

// ---- the picture store (IndexedDB: a Blob, no base64 bloat, no localStorage quota) ------------------------------
const DB_NAME = 'sp-hub-backdrop';
const STORE = 'kv';
const KEY = 'image';
function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('no indexedDB')); return; }
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const rq = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(rq.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
const idbGet = () => withStore('readonly', (s) => s.get(KEY));
const idbPut = (blob) => withStore('readwrite', (s) => s.put(blob, KEY));
const idbDel = () => withStore('readwrite', (s) => s.delete(KEY));

/** Decode a picked file and re-encode it at most MAX_EDGE on its longest side (JPEG). */
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('decode'));
      im.src = url;
    });
    const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#0b1110'; g.fillRect(0, 0, w, h); // a transparent PNG gets the hub's ground colour
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('encode');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Backdrop state for the lobby: the pref, the custom picture's object URL and the actions of the settings dialog.
 * `ready` turns true once the stored picture was looked up (a custom backdrop draws nothing but the sky until then).
 */
export function useHubBackdrop() {
  const [mediaKind,setMediaKind]=useState('image');const revision=useRef(0);
  const [pref, setPref] = useState(loadBackdropPref);
  const [imageUrl, setImageUrl] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let dead = false;const initialRevision=revision.current;
    idbGet().then((blob) => {
      if (!dead && initialRevision===revision.current && blob instanceof Blob) {setMediaKind(blob.type.startsWith('video/')?'video':'image');setImageUrl(URL.createObjectURL(blob));}
    }).catch(() => {}).finally(() => { if (!dead) setReady(true); });
    return () => { dead = true; };
  }, []);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);
  const update = (patch) => setPref((p) => {
    const next = { ...p, ...patch };
    savePref(PREF_KEY, next);
    return next;
  });
  /** @returns {Promise<boolean>} false when the picture is shown but could not be stored on this device */
  const setImage = async (file) => {
    ++revision.current;const video=file.type.startsWith('video/')||/\.(mp4|webm|m4v)$/i.test(file.name||'');
    const blob = video?await validateVideo(file):await shrink(file);
    let saved = true;
    try { await idbPut(blob); } catch { saved = false; }
    setImageUrl(URL.createObjectURL(blob));
    setMediaKind(video?'video':'image');update({ theme: 'custom',videoPaused:false,videoSound:false });
    return saved;
  };
  const clearImage = async () => {
    ++revision.current;setMediaKind('image');
    try { await idbDel(); } catch { /* nothing stored */ }
    setImageUrl(null);
    update({ theme: 'night', dim: 45, blur: 0 });
  };
  return { pref, update, imageUrl, mediaKind, ready, setImage, clearImage };
}

/** What the backdrop draws: a theme id, 'photo' (custom picture) or 'blank' (custom picture still loading). */
function sceneOf(bg) {
  if (bg.pref.theme !== 'custom') return bg.pref.theme;
  return bg.imageUrl ? 'photo' : bg.ready ? 'night' : 'blank';
}
/** The `data-hub-theme` of the lobby root: the colour tokens shared by the backdrop, the radar and the swatches. */
export function backdropTheme(bg) {
  const s = sceneOf(bg);
  return s === 'photo' ? 'custom' : s === 'blank' ? 'night' : s;
}

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
  while (pts.length < 65) {
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

function Scene({ theme }) {
  return html`
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
      style=${`left:${m.x.toFixed(2)}%;top:${m.y.toFixed(2)}%;width:${m.s.toFixed(1)}px;height:${m.s.toFixed(1)}px;--d:${m.d.toFixed(1)}s;--dl:-${m.dl.toFixed(1)}s`}></i>`)}</div>` : null}`;
}

export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
async function validateVideo(file) {
  if (!file.size || file.size>MAX_VIDEO_BYTES) throw Error('视频大小上限为 60MB');
  if (!/\.(mp4|webm|m4v)$/i.test(file.name||'')) throw Error('请选择 MP4 或 WebM 视频');
  const type=file.type||(/\.webm$/i.test(file.name)?'video/webm':'video/mp4');
  const blob=new Blob([file],{type}),url=URL.createObjectURL(blob),v=document.createElement('video');v.preload='metadata';v.muted=true;
  try {await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('视频读取超时，请换一个文件')),12000);
    v.onloadedmetadata=()=>{clearTimeout(t);if(!Number.isFinite(v.duration)||v.duration<=0||!v.videoWidth||!v.videoHeight)reject(Error('视频文件无效'));
      else if(v.videoWidth*v.videoHeight>1920*1080||Math.max(v.videoWidth,v.videoHeight)>1920)reject(Error('请使用最高 1080p 的视频'));else resolve();};
    v.onerror=()=>{clearTimeout(t);reject(Error('浏览器无法播放，请使用 H.264 MP4 或 WebM'));};v.src=url;
  });return blob;} finally{v.onloadedmetadata=v.onerror=null;v.removeAttribute('src');v.load();URL.revokeObjectURL(url);}
}
const videoSoundEvent = active => window.dispatchEvent(new CustomEvent('sp:lobby-video-audio',{detail:{active}}));
function HubVideo({bg}) {
  const ref=useRef(null),prefRef=useRef(bg.pref);prefRef.current=bg.pref;
  useEffect(()=>{
    const v=ref.current;let node=null,dead=false,claimed=false;
    const claim=active=>{if(claimed!==active){claimed=active;videoSoundEvent(active);}};
    const sync=()=>{
      const pref=prefRef.current;
      if(dead)return;
      if(pref.videoPaused||document.hidden){v.pause();claim(false);return;}
      let sound=pref.videoSound;
      if(sound&&!node&&audio.ctx){try{node=audio.ctx.createMediaElementSource(v);node.connect(audio.bgmGain);}catch{sound=false;}}
      if(sound&&!node)sound=false;
      v.muted=!sound;
      if(!v.paused){claim(sound);return;}
      v.play().then(()=>{if(!dead)claim(sound&&!v.muted);},()=>{
        if(dead)return;claim(false);v.muted=true;v.play().catch(()=>{});
      });
    };
    const gesture=()=>{if(prefRef.current.videoSound)audio._unlock();sync();};
    const stop=()=>claim(false);
    v.addEventListener('pause',stop);v.addEventListener('error',stop);
    window.addEventListener('pointerdown',gesture,{passive:true});window.addEventListener('sp:lobby-video-sync',sync);document.addEventListener('visibilitychange',sync);sync();
    return()=>{dead=true;v.removeEventListener('pause',stop);v.removeEventListener('error',stop);window.removeEventListener('pointerdown',gesture);window.removeEventListener('sp:lobby-video-sync',sync);document.removeEventListener('visibilitychange',sync);v.pause();claim(false);node?.disconnect();v.removeAttribute('src');v.load();};
  },[]);
  useEffect(()=>{window.dispatchEvent(new Event('sp:lobby-video-sync'));},[bg.pref.videoSound,bg.pref.videoPaused]);
  return html`<video ref=${ref} class="hub-bg__video" src=${bg.imageUrl} loop playsInline preload="metadata" muted style=${`position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:${bg.pref.blur?`blur(${bg.pref.blur}px)`:'none'}`} />`;
}

/** The hub's backdrop layer (behind everything; never takes pointer events). */
export function HubBackdrop({ bg }) {
  const scene = sceneOf(bg);
  const { pref } = bg;
  return html`<div class="hub-bg" data-scene=${scene} data-motion=${pref.motion ? 'on' : 'off'} aria-hidden="true">
    ${scene === 'photo'
      ? html`${bg.mediaKind==='video'?html`<${HubVideo} key=${bg.imageUrl} bg=${bg} />`:html`<div class="hub-bg__photo" style=${`background-image:url("${bg.imageUrl}");filter:${pref.blur ? `blur(${pref.blur}px)` : 'none'}`}></div>`}
        <div class="hub-bg__shade" style=${`opacity:${pref.dim / 100}`}></div>`
      : scene === 'blank' ? html`<div class="hub-bg__sky"></div>` : html`<${Scene} theme=${scene} />`}
    ${scene !== 'photo' || pref.overlay ? html`<div class="hub-bg__grid"></div><div class="hub-bg__dots"></div>` : null}
    <div class="hub-bg__scan"></div>
    <div class="hub-bg__vignette"></div>
  </div>`;
}

/** Range rings and a slow sweep behind the emblem (the sweep only with motion on, never on 静默). */
export function HubRadar({ bg }) {
  const sweep = bg.pref.motion && sceneOf(bg) !== 'calm';
  return html`<div class="hub-radar" aria-hidden="true">
    <svg viewBox="-240 -240 480 480">
      <circle r="92" /><circle r="152" /><circle class="hub-radar__ticks" r="214" />
      <path d="M-236 0H-176M176 0H236M0 -236V-176M0 176V236" />
    </svg>
    ${sweep ? html`<i class="hub-radar__sweep"></i>` : null}
  </div>`;
}

/** The topbar button glyph: a framed landscape. */
export function BackdropGlyph() {
  return html`<svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" fill-rule="evenodd" d="M2 4h20v16H2zm2 2v9.6l4.6-4.8 3.6 3.7 2.6-2.6L20 17V6zm13 1.6a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z" />
  </svg>`;
}

function Swatch({ theme }) {
  return html`<span class="bgset__swatch" data-hub-theme=${theme} aria-hidden="true">
    <svg viewBox="0 0 160 90" preserveAspectRatio="none">
      <path class="sw-far" d="M0 56L18 49L34 53L56 38L76 47L98 36L122 49L142 42L160 51V90H0Z" />
      <path class="sw-mid" d="M0 68L28 62L50 66H56V60H60V55H66V48H70V55H76V60H100V66L124 62L160 68V90H0Z" />
      <path class="sw-near" d="M0 80L40 74L90 79L130 73L160 78V90H0Z" />
      <circle class="sw-beacon" cx="68" cy="46" r="1.3" />
    </svg>
  </span>`;
}

/** The body of the 大厅背景 dialog. */
export function BackdropSettings({ bg }) {
  const { pref, update, imageUrl } = bg;
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const browse = () => fileRef.current?.click();
  const onFile = async (e) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const video=file.type.startsWith('video/')||/\.(mp4|webm|m4v)$/i.test(file.name||'');
    if(!video&&!/^image\//.test(file.type)){toast('请选择图片、MP4 或 WebM 视频','warn');return;}
    if(file.size>(video?MAX_VIDEO_BYTES:MAX_FILE)){toast(video?'视频太大（上限 60MB）':'图片太大（上限 30MB）','warn');return;}
    setBusy(true);
    try {
      if (!(await bg.setImage(file))) toast('这个浏览器无法保存背景：本次可以使用，刷新后会恢复默认背景', 'warn');
    } catch(e) {
      toast(e.message||'背景读取失败，换一个文件试试', 'warn');
    } finally {
      setBusy(false);
    }
  };
  const custom = pref.theme === 'custom';
  return html`<div class="bgset">
    <div class="bgset__themes" role="radiogroup" aria-label="背景主题">
      ${HUB_THEMES.map((x) => html`<button key=${x.id} type="button" role="radio" aria-checked=${pref.theme === x.id ? 'true' : 'false'}
          class=${`bgset__theme${pref.theme === x.id ? ' is-selected' : ''}`} onClick=${() => update({ theme: x.id })}>
        <${Swatch} theme=${x.id} />
        <span class="bgset__name">${x.name}</span><span class="bgset__en">${x.en}</span>
      </button>`)}
      <button type="button" role="radio" aria-checked=${custom ? 'true' : 'false'} class=${`bgset__theme${custom ? ' is-selected' : ''}`}
          onClick=${() => (imageUrl ? update({ theme: 'custom' }) : browse())}>
        <span class="bgset__swatch bgset__swatch--custom" style=${imageUrl && bg.mediaKind!=='video' ? `background-image:url("${imageUrl}")` : ''} aria-hidden="true">
          ${bg.mediaKind==='video'&&imageUrl?html`<span class="bgset__plus">▶</span>`:imageUrl ? null : html`<span class="bgset__plus">+</span>`}
        </span>
        <span class="bgset__name">自定义背景</span><span class="bgset__en">CUSTOM</span>
      </button>
    </div>
    <input ref=${fileRef} type="file" accept="image/*,video/mp4,video/webm,.mp4,.webm,.m4v" hidden onChange=${onFile} />
    ${custom && imageUrl ? html`<div class="bgset__custom">
      <div class="bgset__row">
        <button type="button" class="btn btn--secondary btn--sm" disabled=${busy} onClick=${browse}><span class="btn__label">${busy ? '处理中…' : '更换背景'}</span></button>
        <button type="button" class="btn btn--ghost btn--sm" disabled=${busy} onClick=${() => bg.clearImage()}><span class="btn__label">移除背景</span></button>
      </div>
      ${bg.mediaKind==='video'?html`<label class="bgset__check"><input type="checkbox" checked=${pref.videoSound} onChange=${e=>{audio._unlock();update({videoSound:e.currentTarget.checked});}} /><span>播放视频声音（暂停大厅 BGM）</span></label><button type="button" class="btn btn--secondary btn--sm" onClick=${()=>update({videoPaused:!pref.videoPaused})}>${pref.videoPaused?'播放视频':'暂停视频'}</button>`:null}
      <label class="bgset__slider"><span>暗化</span>
        <input type="range" min="0" max="85" step="1" value=${pref.dim} onInput=${(e) => update({ dim: Number(e.currentTarget.value) })} />
        <b class="num">${pref.dim}%</b></label>
      <label class="bgset__slider"><span>模糊</span>
        <input type="range" min="0" max="16" step="1" value=${pref.blur} onInput=${(e) => update({ blur: Number(e.currentTarget.value) })} />
        <b class="num">${pref.blur}px</b></label>
      <label class="bgset__check"><input type="checkbox" checked=${pref.overlay} onChange=${(e) => update({ overlay: e.currentTarget.checked })} /><span>叠加战术网格</span></label>
    </div>` : busy ? html`<p class="bgset__note">图片处理中…</p>` : null}
    <label class="bgset__check"><input type="checkbox" checked=${pref.motion} onChange=${(e) => update({ motion: e.currentTarget.checked })} /><span>动态效果（云层、粒子、雷达扫描）</span></label>
    <p class="bgset__note">图片上限 30MB；视频上限 60MB、最高 1080p，推荐横版 H.264 MP4 / WebM。仅保存在当前浏览器。视频默认静音，可搭配 ♫ 大厅音乐；切出大厅或隐藏网页会暂停视频。</p>
  </div>`;
}
