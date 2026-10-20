// 自定义大厅背景与音乐 (PR #643 split 8): one of four generated scenes (ui/hubScene.js: 夜巡 / 霜原 / 烬野 / 静默) or the
// player's own picture or video behind the lobby, in place of the official backdrop (screens/lobby.js HubBackdrop), and own music in place of the lobby's track (audio.js setLobbyTrack: wherever
// the lobby's music plays — title, lobby, room, briefing, draft, 协议启动, result — through the same 背景音乐 volume).
//
// The files stay in this browser: IndexedDB 'sp-lobby-media', one record per kind ('backdrop', 'music'), never uploaded
// and never seen by a teammate. Which of them is on, the scene and the backdrop's 暗度 are a pref (lobby.media). A file is checked
// when it is chosen — its type and size, then that this browser can actually show / decode it — and refused with a
// message otherwise. One that stops working later (storage cleared, a codec gone) falls back to the official backdrop /
// track with a toast. A video plays muted and loops; with reduced motion it stands on its first frame. The site CSP
// allows blob: media for that video (server/http/csp.js); the music is decoded from its bytes (no media element).
// Texts go through t() (docs/I18N.md).
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, Modal, Tooltip } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { audio } from '../audio.js';
import { toast } from './toasts.js';
import { reducedMotion } from './device.js';
import { HUB_SCENES, SCENE_IDS, HubScene, SceneSwatch } from './hubScene.js';
import { t, tc } from '../../../shared/i18n.js';

const MB = 1024 * 1024;
/** Size limits of the player's own files (bytes). */
export const MEDIA_LIMITS = Object.freeze({ image: 20 * MB, video: 60 * MB, music: 20 * MB });
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/;
const VIDEO_TYPES = /^video\/(mp4|webm)$/;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm)$/i;
const MUSIC_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|webm)$/i;
const PREF = 'lobby.media';
const DB = 'sp-lobby-media';
const TABLE = 'files';

/** The saved switches, sanitised: own backdrop / own music on, the backdrop's 暗度 (0–0.8), the scene ('official' or a generated one). */
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
    if (!kind) return { ok: false, reason: t('请选择 PNG、JPG、WebP 图片或 MP4、WebM 视频') };
  } else {
    if (type.startsWith('audio/') || ((!type || type === 'video/webm' || type === 'application/ogg') && MUSIC_EXT.test(name))) kind = 'music';
    if (!kind) return { ok: false, reason: t('请选择 MP3、M4A、OGG、WAV 等音频文件') };
  }
  if (file.size > MEDIA_LIMITS[kind]) return { ok: false, reason: t('文件不能超过 {n} MB', { n: MEDIA_LIMITS[kind] / MB }) };
  return { ok: true, kind };
}

// ---- storage (IndexedDB; a browser without it keeps the official backdrop and music) ------------------------------------

let dbOpen = null;
function db() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('no IndexedDB'));
  return dbOpen ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABLE);
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); dbOpen = null; }; resolve(d); };
    req.onerror = () => { dbOpen = null; reject(req.error || new Error('IndexedDB')); };
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(TABLE, mode);
    const req = fn(tx.objectStore(TABLE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('IndexedDB'));
  });
}
const readRecord = (slot) => idb('readonly', (s) => s.get(slot));
const writeRecord = (slot, rec) => idb('readwrite', (s) => (rec ? s.put(rec, slot) : s.delete(slot)));

// ---- state ------------------------------------------------------------------------------------------------------------

/** { prefs, backdrop: { kind, name, size, url } | null, music: { name, size, id } | null, busy: null | 'backdrop' | 'music' } */
export const mediaStore = createStore({ prefs: loadMediaPrefs(), backdrop: null, music: null, busy: null });
let musicBlob = null;
const savePrefs = (patch) => {
  const prefs = { ...mediaStore.get().prefs, ...patch };
  savePref(PREF, prefs);
  mediaStore.set({ prefs });
};
const syncMusic = () => {
  const { prefs, music } = mediaStore.get();
  audio.setLobbyTrack(prefs.music && music && musicBlob ? { id: music.id, read: () => musicBlob.arrayBuffer() } : null);
};
function showBackdrop(rec) {
  const old = mediaStore.get().backdrop;
  if (old?.url) URL.revokeObjectURL(old.url);
  mediaStore.set({ backdrop: rec ? { kind: rec.kind, name: rec.name, size: rec.blob.size, url: URL.createObjectURL(rec.blob) } : null });
}
function keepMusic(rec) {
  musicBlob = rec ? rec.blob : null;
  mediaStore.set({ music: rec ? { name: rec.name, size: rec.blob.size, id: String(rec.savedAt) } : null });
  syncMusic();
}

let installed = false;
/** Load the saved files once (main.js, at start): the music applies from the title screen on. */
export async function installLobbyMedia() {
  if (installed) return;
  installed = true;
  audio.onLobbyTrackFailed = () => {
    savePrefs({ music: false });
    toast(t('自定义大厅音乐无法播放，已换回默认音乐'), 'warn');
  };
  try {
    const [bg, music] = await Promise.all([readRecord('backdrop'), readRecord('music')]);
    if (bg?.blob instanceof Blob && (bg.kind === 'image' || bg.kind === 'video')) showBackdrop(bg);
    if (music?.blob instanceof Blob) keepMusic(music);
  } catch { /* no storage: the official backdrop and music */ }
}

// ---- checks that need the browser ------------------------------------------------------------------------------------

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
/** That this browser can show the picture / play the video (its first frame). */
function probeBackdrop(file, kind) {
  const url = URL.createObjectURL(file);
  const el = kind === 'image' ? new Image() : document.createElement('video');
  const done = new Promise((resolve, reject) => {
    const fail = () => reject(new Error(kind === 'image' ? t('这台浏览器无法显示这张图片') : t('这台浏览器无法播放这个视频，请换成 H.264 MP4 或 WebM')));
    if (kind === 'image') { el.onload = () => (el.naturalWidth > 0 ? resolve() : fail()); el.onerror = fail; } else {
      el.muted = true; el.preload = 'auto';
      el.onloadeddata = () => (el.videoWidth > 0 ? resolve() : fail()); el.onerror = fail;
    }
    el.src = url;
  });
  return withTimeout(done, 10000, t('读取文件超时，请换一个文件')).finally(() => {
    el.onload = el.onerror = el.onloadeddata = null;
    el.removeAttribute('src');
    if (kind === 'video') el.load();
    URL.revokeObjectURL(url);
  });
}
/** That the music decodes (without a media element, so before any gesture too). */
async function probeMusic(file) {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx(1, 1, 44100);
  const buf = await withTimeout(new Promise((resolve, reject) => {
    file.arrayBuffer().then((ab) => {
      const r = ctx.decodeAudioData(ab, resolve, reject);
      if (r && typeof r.then === 'function') r.then(resolve, reject);
    }, reject);
  }), 20000, t('读取文件超时，请换一个文件')).catch(() => null);
  if (!buf || !(buf.duration > 0)) throw new Error(t('这台浏览器无法播放这段音乐，请换成 MP3 或 M4A'));
}

/**
 * Take the player's file for a slot: checked, saved in this browser, switched on.
 * @param {'backdrop'|'music'} slot @param {File} file
 * @returns {Promise<boolean>} whether it was taken (a refusal shows its reason)
 */
export async function chooseMedia(slot, file) {
  if (mediaStore.get().busy) return false;
  const c = classifyFile(file, slot);
  if (!c.ok) { toast(c.reason, 'warn'); return false; }
  mediaStore.set({ busy: slot });
  try {
    if (slot === 'backdrop') await probeBackdrop(file, c.kind); else await probeMusic(file);
    const rec = { blob: file, name: String(file.name || '').slice(0, 120), kind: c.kind, savedAt: Date.now() };
    try { await writeRecord(slot, rec); } catch { throw new Error(t('浏览器存储空间不足，未能保存')); }
    if (slot === 'backdrop') showBackdrop(rec); else keepMusic(rec);
    savePrefs({ [slot]: true });
    if (slot === 'music') syncMusic();
    return true;
  } catch (err) {
    toast(err?.message || t('未能读取这个文件'), 'warn');
    return false;
  } finally { mediaStore.set({ busy: null }); }
}

/** Delete the player's file of a slot (back to the official one). */
export async function removeMedia(slot) {
  try { await writeRecord(slot, null); } catch { /* the record goes with the storage anyway */ }
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
 * The player's own backdrop, over the official one (screens/lobby.js HubBackdrop draws it inside .hub-bg), or null.
 * A file that fails to show here switches itself off.
 */
export function OwnBackdrop() {
  const s = useStore((x) => x, undefined, mediaStore);
  const bg = s.backdrop;
  const still = reducedMotion();
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (v && bg?.kind === 'video' && !still) v.play?.().catch(() => {});
  }, [bg?.url]);
  if (!bg || !s.prefs.backdrop) return null;
  const broken = () => { setMediaOn('backdrop', false); toast(t('自定义大厅背景无法显示，已换回默认背景'), 'warn'); };
  return html`<div class=${`hub-bg__own hub-bg__own--${bg.kind}`} style=${`--own-dim:${s.prefs.dim}`} data-testid="own-backdrop">
    ${bg.kind === 'image'
      ? html`<img src=${bg.url} alt="" draggable=${false} onError=${broken} />`
      : html`<video ref=${ref} src=${bg.url} muted=${true} loop=${true} playsinline=${true} autoplay=${!still} preload="auto"
          disablepictureinpicture=${true} onError=${broken}></video>`}
  </div>`;
}

/** The chosen generated scene, over the official backdrop and under the own picture (null for 'official'). */
export function LobbyScene() {
  const scene = useStore((x) => x.prefs.scene, undefined, mediaStore);
  return html`<${HubScene} theme=${scene} />`;
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
    <p class="lmedia__note"><${Icon} name="info" />${t('文件只保存在这台浏览器里，不会上传，队友也看不到。图片不超过 20 MB；视频不超过 60 MB，静音循环播放；音乐不超过 20 MB，替换标题、大厅、房间、开局前和结算时的音乐，音量跟随「背景音乐」。')}</p>
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
