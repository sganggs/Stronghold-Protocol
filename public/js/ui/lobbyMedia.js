// 自定义大厅背景与音乐 (PR #643 split 8): one of four generated scenes (ui/hubScene.js: 夜巡 / 霜原 / 烬野 / 静默) or the
// player's own picture or video behind the lobby, in place of the official backdrop (screens/lobby.js HubBackdrop), and own music in place of the lobby's track (audio.js setLobbyTrack: wherever
// the lobby's music plays — title, lobby, room, briefing, draft, 协议启动, result — through the same 背景音乐 volume; it
// also takes the place of a cosmetic plugin's audio.bgm.lobby in this browser).
//
// The files stay in this browser: IndexedDB 'sp-lobby-media', one record per kind ('backdrop', 'music'), never uploaded
// and never seen by a teammate. The database is opened at start only when one of the files is switched on, else when the
// dialog opens (a visitor who never opens it never creates it). Which of them is on, the scene and the backdrop's
// 暗度 are a pref (lobby.media). A file is checked when it is chosen — its type and size, then that this browser can
// actually show / decode it, and its pixels or length — and refused with a message otherwise: a picture whose longest
// edge is past 2560 px is scaled down (a still one; one that moves is refused), a video above 1080p is refused (#643's
// guards), music longer than 6 minutes is refused (it is decoded whole into PCM). One that stops working later (storage
// cleared, a codec gone) falls back to the official backdrop / track with a toast. A video plays muted and loops; with
// reduced motion it stands on its first frame, and so does a picture that moves (GIF, APNG, animated WebP / AVIF). The
// site CSP allows blob: media for that video and for the music's length check (server/http/csp.js); the music itself
// is decoded from its bytes (no media element). Texts go through t() (docs/I18N.md).
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, Modal, Tooltip } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { audio } from '../audio.js';
import { toast } from './toasts.js';
import { reducedMotion } from './device.js';
import { HUB_SCENES, SCENE_IDS, HubScene, SceneSwatch } from './hubScene.js';
import { t, tc } from '../../../shared/i18n.js';

const MB = 1024 * 1024;
/**
 * Size limits of the player's own files (bytes). [ASSUMED] A remake feature the official event does not have: #643 took
 * 30 MB pictures, 60 MB videos and 20 MB music; this split takes 20 / 60 / 20.
 */
export const MEDIA_LIMITS = Object.freeze({ image: 20 * MB, video: 60 * MB, music: 20 * MB });
/** A picture's longest edge kept: a larger still one is scaled down when it is chosen (#643 MAX_EDGE / shrink). */
export const MAX_EDGE = 2560;
/** The largest video: 1080p, at most 1920×1080 pixels and 1920 on its longest side (#643 validateVideo). */
export const MAX_VIDEO = Object.freeze({ pixels: 1920 * 1080, edge: 1920 });
/**
 * The longest own music (seconds). [ASSUMED] It is decoded whole: 6 minutes of 48 kHz stereo are ~138 MB of PCM, about
 * twice the longest official track (m_bat_kazimierz2_2_loop, 190.9 s); a song is 3–5 minutes.
 */
export const MUSIC_MAX_S = 6 * 60;
/** [ASSUMED] How long a check may take: a picture / video, the music's metadata, its decode, opening the database, a write. */
const TIMEOUTS = Object.freeze({ backdrop: 10000, length: 5000, music: 20000, open: 8000, write: 30000 });
/** Bytes read to tell a moving picture (isAnimatedImage). */
const SNIFF_BYTES = 64 * 1024;
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/;
const VIDEO_TYPES = /^video\/(mp4|webm)$/;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm)$/i;
const MUSIC_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|webm)$/i;
const PREF = 'lobby.media';
const DB = 'sp-lobby-media';
const TABLE = 'files';

/**
 * The saved switches, sanitised: own backdrop / own music on, the backdrop's 暗度 (0–0.8, 0.35 by default [ASSUMED]: #643
 * had 0.45 within 0–0.85), the scene ('official' or a generated one).
 */
export function loadMediaPrefs(raw = loadPref(PREF, null)) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const dim = Number(o.dim);
  return {
    backdrop: o.backdrop === true, music: o.music === true, dim: Number.isFinite(dim) ? Math.min(0.8, Math.max(0, dim)) : 0.35,
    scene: SCENE_IDS.includes(o.scene) ? o.scene : 'official',
  };
}

/**
 * What a chosen file is for its slot, or the reason it is refused (before anything is read): a picture or a video for
 * the backdrop, an audio file for the music; a type the browser names wins over the extension.
 * @param {{ name?: string, type?: string, size?: number } | null} file
 * @param {'backdrop'|'music'} slot
 * @returns {{ ok: true, kind: 'image'|'video'|'music' } | { ok: false, reason: string }}
 */
export function classifyFile(file, slot) {
  if (!file || !(file.size > 0)) return { ok: false, reason: t('文件是空的') };
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '');
  let kind = null;
  if (slot === 'backdrop') {
    if (IMAGE_TYPES.test(type) || (!type && IMAGE_EXT.test(name))) kind = 'image';
    else if (VIDEO_TYPES.test(type) || (!type && VIDEO_EXT.test(name))) kind = 'video';
    if (!kind) return { ok: false, reason: t('请选择 PNG、JPG、WebP、GIF、AVIF 图片或 MP4、WebM 视频') };
  } else {
    if (type.startsWith('audio/') || ((!type || type === 'video/webm' || type === 'application/ogg') && MUSIC_EXT.test(name))) kind = 'music';
    if (!kind) return { ok: false, reason: t('请选择 MP3、M4A、OGG、WAV 等音频文件') };
  }
  if (file.size > MEDIA_LIMITS[kind]) return { ok: false, reason: t('文件不能超过 {n} MB', { n: MEDIA_LIMITS[kind] / MB }) };
  return { ok: true, kind };
}

/**
 * Whether a picture may move, from its first bytes (nothing decoded): any GIF (not parsed further), an APNG (an acTL
 * chunk before the first IDAT), an animated WebP (the VP8X animation flag) or an AVIF image sequence (an 'avis' brand).
 * Such a picture is never re-encoded (that would keep one frame) and stands still with reduced motion.
 * @param {Uint8Array | null | undefined} b the file's first bytes (SNIFF_BYTES)
 */
export function isAnimatedImage(b) {
  if (!b || b.length < 12) return false;
  const str = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (str(0, 3) === 'GIF') return true;
  if (b[0] === 0x89 && str(1, 3) === 'PNG') {
    let o = 8;
    while (o + 8 <= b.length) { // loop-cap: one pass per PNG chunk header within the sniffed bytes (each pass moves ≥ 12 bytes)
      const type = str(o + 4, 4);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      o += 12 + u32(o);
    }
    return false;
  }
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') return str(12, 4) === 'VP8X' && b.length > 20 && (b[20] & 0x02) !== 0;
  if (str(4, 4) === 'ftyp') {
    const end = Math.min(u32(0), b.length);
    for (let o = 8; o + 4 <= end; o += 4) if (o !== 12 && str(o, 4) === 'avis') return true; // brands; 12 is the minor version
  }
  return false;
}

/** The size a picture of w×h is kept at: its longest edge at most MAX_EDGE. */
export function fitEdge(w, h) {
  const k = Math.min(1, MAX_EDGE / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Whether a video of w×h is above 1080p (#643: more than 1920×1080 pixels, or a side above 1920). */
export const videoTooLarge = (w, h) => w * h > MAX_VIDEO.pixels || Math.max(w, h) > MAX_VIDEO.edge;

/** A promise that rejects with `msg` (an Error marked `timeout`) after `ms`. */
function withTimeout(p, ms, msg) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(msg), { timeout: true })), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

// ---- storage (IndexedDB; a browser without it keeps the official backdrop and music) ------------------------------------

let dbOpen = null;
function db() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('no IndexedDB'));
  if (dbOpen) return dbOpen;
  let late = false;
  const open = withTimeout(new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABLE);
    req.onsuccess = () => {
      const d = req.result;
      if (late) { d.close(); return; } // it answered after the timeout: the next try opens it again
      d.onversionchange = () => { d.close(); dbOpen = null; };
      resolve(d);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB'));
  }), TIMEOUTS.open, 'IndexedDB open timed out');
  dbOpen = open.catch((err) => { late = true; dbOpen = null; throw err; });
  return dbOpen;
}
async function idb(mode, fn) {
  const d = await db();
  return withTimeout(new Promise((resolve, reject) => {
    const tx = d.transaction(TABLE, mode);
    const req = fn(tx.objectStore(TABLE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || req?.error || new Error('IndexedDB'));
  }), TIMEOUTS.write, 'IndexedDB timed out');
}
const readRecord = (slot) => idb('readonly', (s) => s.get(slot));
const writeRecord = (slot, rec) => idb('readwrite', (s) => (rec ? s.put(rec, slot) : s.delete(slot)));
/** The message of a save that failed: 浏览器存储空间不足 only when the browser says the quota is full. */
export function storageError(err) {
  const name = String(err?.name || '');
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    ? t('浏览器存储空间不足，未能保存') : t('浏览器存储不可用，未能保存');
}

// ---- state ------------------------------------------------------------------------------------------------------------

/**
 * { prefs, backdrop: { kind, name, size, url, animated } | null, music: { name, size, id } | null,
 *   busy: null | 'backdrop' | 'music' }
 */
export const mediaStore = createStore({ prefs: loadMediaPrefs(), backdrop: null, music: null, busy: null });
let musicBlob = null;
/** Bumped when a slot's file is chosen or deleted: a read of the saved files that started before it is stale. */
const revision = { backdrop: 0, music: 0 };
const savePrefs = (patch) => {
  const prefs = { ...mediaStore.get().prefs, ...patch };
  savePref(PREF, prefs);
  mediaStore.set({ prefs });
};
/** The own track to the audio manager (or none); `decoded`: the file's check already decoded it (no second decode). */
const syncMusic = (decoded = null) => {
  const { prefs, music } = mediaStore.get();
  audio.setLobbyTrack(prefs.music && music && musicBlob ? { id: music.id, read: () => musicBlob.arrayBuffer(), decoded } : null);
};
function showBackdrop(rec) {
  const old = mediaStore.get().backdrop;
  if (old?.url) URL.revokeObjectURL(old.url);
  mediaStore.set({ backdrop: rec ? { kind: rec.kind, name: rec.name, size: rec.blob.size, url: URL.createObjectURL(rec.blob), animated: rec.animated === true } : null });
}
function keepMusic(rec, decoded = null) {
  musicBlob = rec ? rec.blob : null;
  mediaStore.set({ music: rec ? { name: rec.name, size: rec.blob.size, id: String(rec.savedAt) } : null });
  syncMusic(decoded);
}

let loading = null;
/** Read the saved files (once; again after a failure): at start when one of them is on, else when the dialog opens. */
export function loadSavedMedia() {
  if (loading) return loading;
  const rev = { ...revision };
  loading = (async () => {
    try {
      const [bg, music] = await Promise.all([readRecord('backdrop'), readRecord('music')]);
      if (rev.backdrop === revision.backdrop && bg?.blob instanceof Blob && (bg.kind === 'image' || bg.kind === 'video')) showBackdrop(bg);
      if (rev.music === revision.music && music?.blob instanceof Blob) keepMusic(music);
    } catch { loading = null; /* no storage: the official backdrop and music */ }
  })();
  return loading;
}

let installed = false;
/** Main.js, at start: the saved files when one of them is on (the music applies from the title screen on). */
export function installLobbyMedia() {
  if (installed) return Promise.resolve();
  installed = true;
  audio.onLobbyTrackFailed = () => {
    savePrefs({ music: false });
    toast(t('自定义大厅音乐无法播放，已换回默认音乐'), 'warn');
  };
  const { prefs } = mediaStore.get();
  return prefs.backdrop || prefs.music ? loadSavedMedia() : Promise.resolve();
}

// ---- checks that need the browser ------------------------------------------------------------------------------------

/**
 * That this browser can show the picture / play the video, and its size in pixels. A video is read up to its metadata
 * (`loadedmetadata`, as #643): iOS loads no more than that before playback, so waiting for a frame would never end there.
 * @returns {Promise<{ w: number, h: number }>}
 */
function probeBackdrop(file, kind) {
  const url = URL.createObjectURL(file);
  const el = kind === 'image' ? new Image() : document.createElement('video');
  const done = new Promise((resolve, reject) => {
    const fail = () => reject(new Error(kind === 'image' ? t('这台浏览器无法显示这张图片') : t('这台浏览器无法播放这个视频，请换成 H.264 MP4 或 WebM')));
    if (kind === 'image') { el.onload = () => (el.naturalWidth > 0 ? resolve({ w: el.naturalWidth, h: el.naturalHeight }) : fail()); el.onerror = fail; } else {
      el.muted = true; el.playsInline = true; el.setAttribute('playsinline', ''); el.preload = 'metadata';
      el.onloadedmetadata = () => {
        const w = el.videoWidth, h = el.videoHeight;
        if (!(w > 0 && h > 0)) fail();
        else if (videoTooLarge(w, h)) reject(new Error(t('请使用最高 1080p 的视频')));
        else resolve({ w, h });
      };
      el.onerror = fail;
    }
    el.src = url;
  });
  return withTimeout(done, TIMEOUTS.backdrop, t('读取文件超时，请换一个文件')).finally(() => {
    el.onload = el.onerror = el.onloadedmetadata = null;
    el.removeAttribute('src');
    if (kind === 'video') el.load();
    URL.revokeObjectURL(url);
  });
}

/** A still picture above MAX_EDGE scaled down: a JPEG stays JPEG, anything else (it may be transparent) WebP, else PNG. */
async function shrinkPicture(file, size) {
  const { w, h } = fitEdge(size.w, size.h);
  const url = URL.createObjectURL(file);
  const c = document.createElement('canvas');
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(t('这台浏览器无法显示这张图片')));
      im.src = url;
    });
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) throw new Error(t('这台浏览器无法显示这张图片'));
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    const jpeg = String(file.type).toLowerCase() === 'image/jpeg' || (!file.type && /\.jpe?g$/i.test(file.name || ''));
    // WebP keeps transparency; a browser that cannot write it answers PNG (the default), which keeps it too
    const blob = await new Promise((resolve) => c.toBlob(resolve, jpeg ? 'image/jpeg' : 'image/webp', jpeg ? 0.9 : 0.92));
    if (!blob) throw new Error(t('这台浏览器无法显示这张图片'));
    return blob;
  } finally {
    URL.revokeObjectURL(url);
    c.width = c.height = 0;
  }
}

/** The music's length from its metadata (an <audio> element, nothing decoded), or null when this browser cannot tell soon. */
function musicLength(file) {
  if (!globalThis.document) return Promise.resolve(null);
  const url = URL.createObjectURL(file);
  const el = document.createElement('audio');
  return withTimeout(new Promise((resolve) => {
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => resolve(null);
    el.muted = true; el.preload = 'metadata';
    el.src = url;
  }), TIMEOUTS.length, '').catch(() => null).finally(() => {
    el.onloadedmetadata = el.onerror = null;
    el.removeAttribute('src');
    el.load();
    URL.revokeObjectURL(url);
  });
}

/**
 * That the music decodes and is at most MUSIC_MAX_S long. A file whose metadata says it is clearly longer (by more than
 * 30 s) is refused before anything is decoded; otherwise it is decoded once and its decoded length decides — in the
 * audio manager's context, whose buffer then becomes the track (no second decode), or offline before any gesture.
 * A check that takes too long and a file that does not decode are told apart.
 * @returns {Promise<AudioBuffer|null>} the decoded track when the audio manager's context decoded it
 */
async function probeMusic(file) {
  const tooLong = () => new Error(t('音乐不能超过 {n} 分钟', { n: MUSIC_MAX_S / 60 }));
  const len = await musicLength(file);
  if (len != null && len > MUSIC_MAX_S + 30) throw tooLong();
  const live = audio.ctx;
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!live && !Ctx) return null;
  const decode = async () => {
    const ab = await file.arrayBuffer().catch(() => { throw new Error(t('未能读取这个文件')); });
    if (live) return audio.decodeBytes(ab);
    const ctx = new Ctx(1, 1, 44100);
    return new Promise((resolve) => {
      try {
        const r = ctx.decodeAudioData(ab, resolve, () => resolve(null));
        if (r && typeof r.then === 'function') r.then(resolve, () => resolve(null));
      } catch { resolve(null); }
    });
  };
  const buf = await withTimeout(decode(), TIMEOUTS.music, t('读取文件超时，请换一个文件'));
  if (!buf || !(buf.duration > 0)) throw new Error(t('这台浏览器无法播放这段音乐，请换成 MP3 或 M4A'));
  if (buf.duration > MUSIC_MAX_S + 1) throw tooLong();
  return live ? buf : null;
}

/**
 * Take the player's file for a slot: checked (a large still picture scaled down), saved in this browser, switched on.
 * @param {'backdrop'|'music'} slot @param {File} file
 * @returns {Promise<boolean>} whether it was taken (a refusal shows its reason)
 */
export async function chooseMedia(slot, file) {
  if (mediaStore.get().busy) return false;
  const c = classifyFile(file, slot);
  if (!c.ok) { toast(c.reason, 'warn'); return false; }
  mediaStore.set({ busy: slot });
  try {
    let blob = file;
    let animated = false;
    let decoded = null;
    if (slot === 'backdrop') {
      const size = await probeBackdrop(file, c.kind);
      if (c.kind === 'image') {
        animated = isAnimatedImage(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
        if (Math.max(size.w, size.h) > MAX_EDGE) {
          if (animated) throw new Error(t('动图的最长边不能超过 {n} 像素', { n: MAX_EDGE }));
          blob = await shrinkPicture(file, size);
        }
      }
    } else decoded = await probeMusic(file);
    const rec = { blob, name: String(file.name || '').slice(0, 120), kind: c.kind, savedAt: Date.now(), ...(animated ? { animated: true } : {}) };
    try { await writeRecord(slot, rec); } catch (err) { throw new Error(storageError(err), { cause: err }); }
    revision[slot]++;
    if (slot === 'backdrop') { showBackdrop(rec); savePrefs({ backdrop: true }); } else { savePrefs({ music: true }); keepMusic(rec, decoded); }
    return true;
  } catch (err) {
    toast(err?.message || t('未能读取这个文件'), 'warn');
    return false;
  } finally { mediaStore.set({ busy: null }); }
}

/** Delete the player's file of a slot (back to the official one). */
export async function removeMedia(slot) {
  try { await writeRecord(slot, null); } catch (err) {
    toast(storageError(err), 'warn');
    return;
  }
  revision[slot]++;
  if (slot === 'backdrop') showBackdrop(null); else keepMusic(null);
  savePrefs({ [slot]: false });
}

/** Switch the player's file of a slot on or off (kept either way). */
export function setMediaOn(slot, on) {
  savePrefs({ [slot]: !!on });
  if (slot === 'music') syncMusic();
}
/** The own backdrop's 暗度 (0–0.8). */
export const setBackdropDim = (dim) => savePrefs({ dim: loadMediaPrefs({ dim }).dim });
/** The lobby's scene: 'official' (the event's backdrop) or a generated one. */
export const setScene = (scene) => savePrefs({ scene: loadMediaPrefs({ scene }).scene });

// ---- views ------------------------------------------------------------------------------------------------------------

/**
 * A picture that moves, standing on its first frame (reduced motion): drawn once on a canvas, which draws an animated
 * image's first (default) frame.
 */
function StillPicture({ url, onError }) {
  const ref = useRef(null);
  useEffect(() => {
    const img = new Image();
    let dead = false;
    img.onload = () => {
      const c = ref.current;
      if (dead || !c) return;
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d')?.drawImage(img, 0, 0);
    };
    img.onerror = () => { if (!dead) onError(); };
    img.src = url;
    return () => { dead = true; img.onload = img.onerror = null; img.removeAttribute('src'); };
  }, [url]);
  return html`<canvas ref=${ref}></canvas>`;
}

/**
 * The player's own backdrop, over the official one (screens/lobby.js HubBackdrop draws it inside .hub-bg), or null.
 * A file that fails to show here switches itself off. With reduced motion a video is started and stopped at once, so a
 * browser that loads nothing before playback (iOS) still paints its first frame, and a moving picture stands still.
 */
export function OwnBackdrop() {
  const s = useStore((x) => x, undefined, mediaStore);
  const bg = s.backdrop;
  const on = !!bg && s.prefs.backdrop;
  const still = reducedMotion();
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || bg?.kind !== 'video') return;
    const p = v.play?.();
    if (still) p?.then?.(() => v.pause(), () => {});
    else p?.catch?.(() => {});
  }, [bg?.url, on]);
  if (!on) return null;
  const broken = () => { setMediaOn('backdrop', false); toast(t('自定义大厅背景无法显示，已换回默认背景'), 'warn'); };
  return html`<div class=${`hub-bg__own hub-bg__own--${bg.kind}`} style=${`--own-dim:${s.prefs.dim}`} data-testid="own-backdrop">
    ${bg.kind === 'image'
      ? (still && bg.animated
        ? html`<${StillPicture} url=${bg.url} onError=${broken} />`
        : html`<img src=${bg.url} alt="" draggable=${false} onError=${broken} />`)
      : html`<video ref=${ref} src=${bg.url} muted=${true} loop=${true} playsinline=${true} autoplay=${!still} preload="auto"
          disablepictureinpicture=${true} onError=${broken}></video>`}
  </div>`;
}

/**
 * The chosen generated scene, over the official backdrop and under the own picture (null for 'official'); null too while
 * the own backdrop covers it, so its beam, windows and beacons do not animate unseen.
 */
export function LobbyScene() {
  const scene = useStore((x) => x.prefs.scene, undefined, mediaStore);
  const covered = useStore((x) => !!x.backdrop && x.prefs.backdrop, undefined, mediaStore);
  return covered ? null : html`<${HubScene} theme=${scene} />`;
}

/** 大厅场景: the official backdrop and the four generated scenes as swatches. */
function SceneRow({ scene }) {
  return html`<section class="lmedia__part" data-slot="scene">
    <header class="lmedia__head"><b>${t('大厅场景')}</b><${MicroLabel}>SCENE<//></header>
    <div class="bgset__themes" role="radiogroup" aria-label=${t('大厅场景')}>
      ${HUB_SCENES.map((x) => html`<button key=${x.id} type="button" role="radio" aria-checked=${scene === x.id ? 'true' : 'false'}
          class=${`bgset__theme${scene === x.id ? ' is-selected' : ''}`} data-scene=${x.id} onClick=${() => setScene(x.id)}>
        <${SceneSwatch} theme=${x.id} />
        <span class="bgset__name">${t(x.name)}</span><span class="bgset__en">${x.en}</span>
      </button>`)}
    </div>
  </section>`;
}

const sizeText = (n) => `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;

function MediaRow({ slot, title, micro, file, on, busy, accept, chooseText, officialText }) {
  const input = useRef(null);
  return html`<section class="lmedia__part" data-slot=${slot}>
    <header class="lmedia__head"><b>${title}</b><${MicroLabel}>${micro}<//></header>
    <div class="lmedia__now">
      <${Icon} name=${slot === 'music' ? 'music' : 'image'} />
      <span class="lmedia__name" data-testid=${`media-${slot}-name`}>${file && on ? file.name : officialText}</span>
      ${file ? html`<span class="lmedia__size num">${sizeText(file.size)}</span>` : null}
    </div>
    <div class="lmedia__btns">
      <input ref=${input} type="file" hidden accept=${accept} data-testid=${`media-${slot}-file`}
        onChange=${(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) chooseMedia(slot, f); }} />
      <${Button} size="sm" icon="plus" loading=${busy === slot} disabled=${!!busy && busy !== slot} onClick=${() => input.current?.click()}>${chooseText}<//>
      ${file ? html`<button type="button" class=${`set-toggle${on ? ' is-on' : ''}`} role="switch" aria-checked=${on ? 'true' : 'false'}
          data-testid=${`media-${slot}-on`} onClick=${() => setMediaOn(slot, !on)}><i></i><span>${on ? tc('toggle', '开启') : tc('toggle', '关闭')}</span></button>` : null}
      ${file ? html`<${Button} size="sm" variant="ghost" icon="close" data-testid=${`media-${slot}-remove`} onClick=${() => removeMedia(slot)}>${t('删除')}<//>` : null}
    </div>
  </section>`;
}

/** The 大厅背景与音乐 dialog: the own backdrop (picture / video, 暗度) and the own music. */
export function LobbyMediaDialog({ onClose }) {
  const s = useStore((x) => x, undefined, mediaStore);
  useEffect(() => { loadSavedMedia(); }, []);
  const dim = Math.round(s.prefs.dim * 100);
  return html`<${Modal} open=${true} class="lmedia" micro="LOBBY BACKDROP & MUSIC" title=${t('大厅背景与音乐')} width="min(8.6rem, 96vw)"
      onClose=${onClose} actions=${html`<${Button} variant="ghost" onClick=${onClose} data-autofocus="">${t('完成')}<//>`}>
    <${SceneRow} scene=${s.prefs.scene} />
    <${MediaRow} slot="backdrop" title=${t('大厅背景')} micro="BACKDROP" file=${s.backdrop} on=${s.prefs.backdrop} busy=${s.busy}
      accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm" chooseText=${t('选择图片或视频')} officialText=${t('默认背景')} />
    ${s.backdrop && s.prefs.backdrop ? html`<label class="set-row lmedia__dim">
      <span class="set-row__label">${t('暗度')}<${MicroLabel}>DIM<//></span>
      <input class="set-range" type="range" min="0" max="80" step="5" value=${dim} style=${`--pct:${dim / 0.8}%`}
        onInput=${(e) => setBackdropDim(Number(e.currentTarget.value) / 100)} data-testid="media-dim" />
      <span class="set-row__val num">${dim}</span>
    </label>` : null}
    <${MediaRow} slot="music" title=${t('大厅音乐')} micro="MUSIC" file=${s.music} on=${s.prefs.music} busy=${s.busy}
      accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.webm" chooseText=${t('选择音乐文件')} officialText=${t('默认音乐')} />
    <p class="lmedia__note"><${Icon} name="info" />${t('文件只保存在这台浏览器里，不会上传，队友也看不到。图片不超过 20 MB，最长边超过 2560 像素时缩小后保存（动图不能超过 2560 像素）；视频不超过 60 MB、最高 1080p，静音循环播放；音乐不超过 20 MB、6 分钟，替换标题、大厅、房间、开局前和结算时的音乐（外观插件的大厅音乐也被替换），音量跟随「背景音乐」。')}</p>
  <//>`;
}

/** The lobby's entry: a square button that opens the dialog. */
export function LobbyMediaButton({ class: cls = '' }) {
  const [open, setOpen] = useState(false);
  return html`<${Tooltip} text=${t('大厅背景与音乐')} placement="bottom">
      <${Button} variant="secondary" size="sm" square=${true} icon="image" class=${`lobby-media ${cls}`.trim()} data-testid="lobby-media"
        onClick=${() => setOpen(true)} aria-label=${t('大厅背景与音乐')} />
    <//>
    ${open ? html`<${LobbyMediaDialog} onClose=${() => setOpen(false)} />` : null}`;
}
