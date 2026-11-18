// 规程 briefing map (round 71, round 72). Choice order: an official preview picture, then one
// cached render of the stage's 3D board, then the stage's own cells. The picture keys are looked up
// in data/assets.json and data/local-assets.json; none of them is installed (docs/research/07-assets.md
// §7: the board is a 3D scene). The render is stageThumb.js (offscreen, after first paint). Cells use
// ui/fallbackField.js fallbackTileClass.
// [ASSUMED] the crop, that the magnifier opens a larger copy of the same picture, and that INFO_CHECK
// frames every seat's own left board (not the boss-right half and not the 联防 partner half).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Modal } from './components.js';
import { Img } from './gameComponents.js';
import { fallbackTileClass } from './fallbackField.js';
import { settingsStore } from './settingsStore.js';
import { presetCamera } from '../render/projection.js';
import { webgl2Available } from '../render/board3d/load.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * The prep camera's frame (render/projection.js `prep` rect, also render/app.js camRect): bench row 7 through
 * deploy rows 9–12, columns 0–10 inclusive. That is the player's half. The partner half (columns 11–20), the boss
 * field and the pen stay out.
 * Row 0 is the bottom of the stage (shared/constants.js GEO). Cells are listed far-row first so the bench is at
 * the bottom of the thumbnail.
 */
export const STAGE_PREVIEW_CROP = Object.freeze({ r0: 7, r1: 12, c0: 0, c1: 10 });

/** [ASSUMED] The magnifier is a control that opens a larger copy, not a decoration. */
export const STAGE_PREVIEW_ZOOM = 'dialog';

/** CSS px of the offscreen buffer before the quality pixel-ratio cap (16:9, the prep camera's frame). */
const THUMB_CSS = Object.freeze({ width: 320, height: 180 });
/** Buffer cap. High quality at devicePixelRatio 2 lands on this; nothing asks for a larger GPU target. */
const THUMB_CAP = Object.freeze({ width: 640, height: 360 });
/** Same caps as render/app/host.js BOARD_RES. The buffer is resized at dpr 1, so this is the pixel size. */
const THUMB_RES = Object.freeze({ high: 2, medium: 1.25, low: 1 });

const glCache = new Map();

/** Forget the WebGL2 probe (tests). */
export function resetStagePreviewProbe() { glCache.clear(); }

/**
 * The probe's cached answer, or null when this page has not asked yet.
 * Asking during render would open a context on the briefing's first paint, so the probe stays lazy.
 * @param {boolean} [allowSlow] `?board=3d`: a software GPU still counts
 * @returns {boolean|null}
 */
export function stagePreviewGlCached(allowSlow = false) {
  const key = allowSlow ? 'slow' : 'fast';
  return glCache.has(key) ? glCache.get(key) : null;
}

/**
 * One WebGL2 probe per page (board3d/load.js webgl2Available), then the answer is reused.
 * The probe context is released inside webgl2Available. `allowSlow` is only the explicit `?board=3d`.
 * @param {boolean} [allowSlow]
 * @returns {boolean}
 */
export function stagePreviewProbeGl(allowSlow = false) {
  const key = allowSlow ? 'slow' : 'fast';
  if (glCache.has(key)) return glCache.get(key);
  let ok;
  try { ok = !!webgl2Available(!!allowSlow); } catch { ok = false; }
  glCache.set(key, ok);
  return ok;
}

/**
 * Keys a future official preview would use in data/assets.json `ui`.
 * @param {string} stageId
 * @returns {string[]}
 */
export function stagePreviewKeys(stageId) {
  const id = String(stageId || '');
  return [`stagePreview/${id}`, `mapPreview/${id}`, `stageMap/${id}`];
}

/**
 * One cell per coordinate of the crop, even when a row string is short.
 * @param {any} stage stages.json record
 * @param {{ r0: number, r1: number, c0: number, c1: number }} [crop]
 * @returns {{ row: number, col: number, kind: string, special: string|null }[]}
 */
export function stagePreviewCells(stage, crop = STAGE_PREVIEW_CROP) {
  if (!stage || !Array.isArray(stage.rows)) return [];
  const cells = [];
  // far row first: row 0 is the bottom of the stage, so the bench (r0) lands at the bottom of the grid
  for (let row = crop.r1; row >= crop.r0; row--) {
    for (let col = crop.c0; col <= crop.c1; col++) {
      const line = typeof stage.rows[row] === 'string' ? stage.rows[row] : '';
      const glyph = line[col];
      const tile = glyph ? stage.tiles?.[glyph] : null;
      const special = tile && typeof tile.special === 'string' && tile.special ? tile.special : null;
      cells.push({ row, col, kind: fallbackTileClass(stage, row, col), special });
    }
  }
  return cells;
}

/** A local-assets group entry: `{ path }` or a bare URL string. */
function localPath(groups, group, name) {
  const g = groups && typeof groups === 'object' ? groups[group] : null;
  const e = g && typeof g === 'object' ? g[name] : null;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e.path === 'string' && e.path) return e.path;
  return null;
}

/**
 * The local-art manifest lists this stage's official scene (scene.json + scene.bin).
 * Sync, so the briefing can decide without fetching. Missing either file → the cell thumbnail.
 * @param {Record<string, any>|null|undefined} groups data/local-assets.json `groups`
 * @param {string} stageId
 */
export function stageSceneListed(groups, stageId) {
  const id = String(stageId || '');
  if (!id) return false;
  return !!localPath(groups, `scene/${id}`, 'scene') && !!localPath(groups, `scene/${id}`, 'bin');
}

/**
 * '2d' | '3d' | 'fallback' | 'auto'. `?board=2d` and `?render=fallback` (or `__SP_RENDER__ === 'fallback'`)
 * keep the cell thumbnail. `?board=3d` is the explicit WebGL opt-in (software GPUs included).
 * `env.renderer` wins when a test passes one. `env.board` / `env.render` stand in for the URL.
 * @param {{ renderer?: string, board?: string|null, render?: string|null }} [env]
 */
export function stagePreviewRenderer(env) {
  const named = env && typeof env.renderer === 'string' ? env.renderer : '';
  if (named === '2d' || named === '3d' || named === 'fallback' || named === 'auto') return named;
  let board = env && 'board' in env ? env.board : null;
  let render = env && 'render' in env ? env.render : null;
  if (board == null || render == null) {
    try {
      const q = new URLSearchParams(globalThis.location?.search || '');
      if (board == null) board = q.get('board');
      if (render == null) render = q.get('render');
    } catch { /* no location */ }
  }
  if (render === 'fallback' || globalThis.__SP_RENDER__ === 'fallback') return 'fallback';
  if (board === '2d') return '2d';
  if (board === '3d') return '3d';
  return 'auto';
}

/**
 * Own board at 确认本局信息. Seats 0–3 and a spectator all get the left prep crop.
 * [ASSUMED] this screen is before any round, so it does not frame the boss-right half
 * (gameLogic prepCamera side 'R' on a boss-round prep) or the 联防 partner half (columns + 8).
 * @param {number|string|null|undefined} [_seat]
 * @returns {{ r0: number, r1: number, c0: number, c1: number }}
 */
export function stagePreviewFrame(_seat) {
  return { r0: STAGE_PREVIEW_CROP.r0, r1: STAGE_PREVIEW_CROP.r1, c0: STAGE_PREVIEW_CROP.c0, c1: STAGE_PREVIEW_CROP.c1 };
}

/**
 * Prep camera aimed at that crop. 16:9 (and anything at least 4:3) uses the official shop prep camera
 * (`left_shop_camera_param`); a narrower viewport uses the fitted fallback. No HUD is passed: the thumbnail
 * has no shop bar, and the match's open-shop prep camera is the one a round starts on.
 * [ASSUMED] `shop: true`. The briefing has no folded-shop control (`shop: false` is the tighter prepare camera).
 * @param {{ width: number, height: number }} viewport
 * @param {{ seat?: number|null, shop?: boolean, config?: object|null }} [opts]
 */
export function stagePreviewCamera(viewport, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const width = Math.max(1, Number(viewport?.width) || THUMB_CSS.width);
  const height = Math.max(1, Number(viewport?.height) || THUMB_CSS.height);
  return presetCamera('prep', { width, height }, {
    rect: stagePreviewFrame(o.seat),
    side: 'L',
    shop: o.shop !== false,
    config: o.config || null,
  });
}

/**
 * Offscreen buffer for one thumbnail. Pixel ratio follows BOARD_RES and is capped at 640×360.
 * `dpr` on the returned size is 1: BoardScene.resize is given the buffer size, not a second scale.
 * @param {string} quality 'high' | 'medium' | 'low'
 * @param {number} [dpr] devicePixelRatio
 */
export function stagePreviewSize(quality, dpr) {
  const q = quality === 'high' || quality === 'low' || quality === 'medium' ? quality : 'medium';
  const cap = THUMB_RES[q];
  const ratio = Math.min(cap, Math.max(1, typeof dpr === 'number' && Number.isFinite(dpr) ? dpr : 1));
  let width = Math.round(THUMB_CSS.width * ratio);
  let height = Math.round(THUMB_CSS.height * ratio);
  const lim = Math.min(1, THUMB_CAP.width / width, THUMB_CAP.height / height);
  width = Math.max(1, Math.round(width * lim));
  height = Math.max(1, Math.round(height * lim));
  return { cssWidth: THUMB_CSS.width, cssHeight: THUMB_CSS.height, width, height, dpr: 1, quality: q };
}

function previewQuality() {
  try {
    const q = settingsStore.get()?.quality;
    return q === 'high' || q === 'low' || q === 'medium' ? q : 'high';
  } catch { return 'high'; }
}

/**
 * Official picture if a manifest already lists one, otherwise a 3D render when the caller already knows
 * WebGL2 is up (`env.webgl2 === true`, or a probe that has already run), otherwise the cell drawing.
 * The probe is not run here: the briefing's first paint must not open a GL context.
 * @param {{ ui?: Record<string, string>|null, localGroups?: Record<string, any>|null }} src
 * @param {string} stageId
 * @param {{ webgl2?: boolean|null, renderer?: string, board?: string|null, render?: string|null, allowSlow?: boolean }} [env]
 * @returns {{ kind: 'picture', url: string, key: string }
 *   | { kind: 'render', stageId: string, key: string }
 *   | { kind: 'cells', assumed: true }}
 */
export function stagePreviewChoice(src, stageId, env) {
  const id = String(stageId || '');
  const ui = src?.ui;
  if (ui && typeof ui === 'object') {
    for (const key of stagePreviewKeys(id)) {
      const url = ui[key];
      if (typeof url === 'string' && url) return { kind: 'picture', url, key };
    }
  }
  const groups = src?.localGroups;
  const local = [
    ['ui/stagePreview', id],
    ['ui/mapPreview', id],
    ['ui/stageMap', id],
    ['ui/season/act3autochess', `map_${id}`],
    ['ui/season/act3autochess', `stage_${id}`],
    ['ui/season/act3autochess', id],
  ];
  for (const [group, name] of local) {
    const url = localPath(groups, group, name);
    if (url) return { kind: 'picture', url, key: `${group}/${name}` };
  }
  const renderer = stagePreviewRenderer(env);
  const allowSlow = renderer === '3d' || env?.allowSlow === true;
  const gl = env && typeof env.webgl2 === 'boolean' ? env.webgl2 : stagePreviewGlCached(allowSlow);
  if (id && renderer !== '2d' && renderer !== 'fallback' && gl === true && stageSceneListed(groups, id)) {
    return { kind: 'render', stageId: id, key: `scene/${id}` };
  }
  return { kind: 'cells', assumed: true };
}

function cellClass(cell) {
  const extra = cell.special && cell.special !== cell.kind && /^[A-Za-z][A-Za-z0-9]*$/.test(cell.special)
    ? `reg-map__cell--${cell.special}` : '';
  return cx('reg-map__cell', `ff-tile--${cell.kind}`, extra);
}

function cellsView(cells, cols, cls, pending) {
  return html`<div class=${cx('reg-map', cls)} data-preview="cells" data-assumed="true"
    data-pending=${pending ? 'render' : undefined}
    style=${`grid-template-columns:repeat(${cols},minmax(0,1fr))`}>
    ${cells.map((c) => html`<i key=${`${c.row}-${c.col}`} class=${cellClass(c)} data-kind=${c.kind} data-row=${c.row} data-col=${c.col} data-special=${c.special || undefined}></i>`)}
  </div>`;
}

/**
 * The thumbnail. A picture uses Img and falls back to the cells when the file fails.
 * A render shows `shot.url` once stageThumb.js has one, and the cells until then (or when it fails).
 * Hookless: the briefing test calls this.
 * @param {{ stage: any, choice: ReturnType<typeof stagePreviewChoice>, class?: string,
 *   shot?: { url: string, renderMs?: number|null }|false|null }} props
 */
export function StageMap({ stage, choice, class: cls, shot }) {
  const cells = stagePreviewCells(stage);
  const cols = STAGE_PREVIEW_CROP.c1 - STAGE_PREVIEW_CROP.c0 + 1;
  if (choice?.kind === 'picture' && choice.url) {
    return html`<div class=${cx('reg-map', 'reg-map--pic', cls)} data-preview="picture" data-key=${choice.key}>
      <${Img} src=${choice.url} class="reg-map__img" alt="" fallback=${cellsView(cells, cols)} />
    </div>`;
  }
  if (choice?.kind === 'render' && shot && shot.url) {
    const ms = Number.isFinite(shot.renderMs) ? String(Math.round(shot.renderMs)) : undefined;
    return html`<div class=${cx('reg-map', 'reg-map--pic', 'reg-map--render', cls)} data-preview="render" data-key=${choice.key}
      data-render-ms=${ms}>
      <${Img} src=${shot.url} class="reg-map__img" alt="" fallback=${cellsView(cells, cols)} />
    </div>`;
  }
  return cellsView(cells, cols, cls, choice?.kind === 'render' && shot == null);
}

/**
 * Thumbnail plus the magnifier. The dialog repeats the stage name and the pool (战场固定 / 战场随机)
 * and the same picture, scaled — a second GPU render of a larger frame is not taken.
 * [ASSUMED] one cached bitmap is enough: another BoardScene would be a second context past the budget.
 * The 3D load starts after first paint (requestAnimationFrame), and only for a 规程 stage whose scene is listed.
 * @param {{ stage: any, choice: ReturnType<typeof stagePreviewChoice>, name?: string, pool?: string,
 *   stageId?: string, localGroups?: Record<string, any>|null, seat?: number|null }} props
 */
export function StagePreview({ stage, choice, name, pool, stageId, localGroups, seat }) {
  const [open, setOpen] = useState(false);
  const [glOk, setGlOk] = useState(() => {
    const renderer = stagePreviewRenderer();
    if (renderer === '2d' || renderer === 'fallback') return false;
    return stagePreviewGlCached(renderer === '3d');
  });
  const [shot, setShot] = useState(undefined);
  const stageRef = useRef(stage);
  const seatRef = useRef(seat);
  const shotId = useRef('');
  stageRef.current = stage;
  seatRef.current = seat;
  const id = String(stage?.id || stageId || choice?.stageId || '');
  const listed = stageSceneListed(localGroups, id);
  const rendererNow = stagePreviewRenderer();
  const blocked = rendererNow === '2d' || rendererNow === 'fallback';
  const showRender = choice?.kind !== 'picture' && !blocked && glOk === true && listed && !!id;
  const effective = choice?.kind === 'picture' ? choice
    : showRender ? { kind: 'render', stageId: id, key: `scene/${id}` }
    : (choice?.kind === 'cells' ? choice : { kind: 'cells', assumed: true });

  useEffect(() => {
    let dead = false;
    if (shotId.current !== id) {
      shotId.current = id;
      setShot(undefined);
    }
    if (choice?.kind === 'picture' || !listed || !id) return undefined;
    const renderer = stagePreviewRenderer();
    if (renderer === '2d' || renderer === 'fallback') return undefined;
    const kick = () => {
      if (dead) return;
      const ok = stagePreviewProbeGl(renderer === '3d');
      if (dead) return;
      if (!ok) { setGlOk(false); return; }
      setGlOk(true);
      setShot((cur) => (cur && cur.url ? cur : null));
      const quality = previewQuality();
      const dpr = globalThis.devicePixelRatio || 1;
      import('./stageThumb.js').then((m) => {
        if (dead) return null;
        return m.loadStageThumb(id, {
          stage: stageRef.current, seat: seatRef.current, quality, dpr, renderer,
        });
      }).then((res) => {
        if (!dead) setShot(res && res.url ? res : false);
      }, () => { if (!dead) setShot(false); });
    };
    let cancel = () => {};
    if (typeof globalThis.requestAnimationFrame === 'function') {
      const handle = requestAnimationFrame(kick);
      cancel = () => cancelAnimationFrame(handle);
    } else {
      const handle = setTimeout(kick, 0);
      cancel = () => clearTimeout(handle);
    }
    return () => { dead = true; cancel(); };
  }, [id, listed, choice?.kind]);

  const label = t('查看战场「{name}」', { name: name || '—' });
  const mapShot = effective?.kind === 'render' ? shot : undefined;
  return html`<div class="reg-stage" data-stage=${id || undefined}>
    <div class="reg-preview">
      <${StageMap} stage=${stage} choice=${effective} shot=${mapShot} />
      <button type="button" class="reg-preview__zoom" aria-label=${label} onClick=${() => setOpen(true)}>
        <${Icon} name="search" />
      </button>
    </div>
    <${Modal} open=${open} onClose=${() => setOpen(false)} class="reg-mapdlg" title=${t('本局战场')} micro="BATTLEFIELD"
      actions=${html`<${Button} variant="secondary" icon="close" onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <p class="reg-mapdlg__name"><b>${name || '—'}</b>${pool ? html`<span>${pool}</span>` : null}</p>
      <${StageMap} stage=${stage} choice=${effective} shot=${mapShot} class="reg-map--lg" />
    <//>
  </div>`;
}
