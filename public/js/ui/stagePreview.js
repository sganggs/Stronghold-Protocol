// 规程 briefing map (round 71). Official frames show a picture of the round's board with a magnifier.
// data/assets.json, data/local-assets.json and the 规程 UI group ui/season/act3autochess have no composed
// stage-preview picture (docs/research/07-assets.md §7: the board is a 3D scene). stagePreviewChoice looks
// those manifests up anyway, so a picture added later wins; until then the thumbnail is the stage's own cells
// (ui/fallbackField.js fallbackTileClass). [ASSUMED] the crop and that the magnifier opens this larger.

import { useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Modal } from './components.js';
import { Img } from './gameComponents.js';
import { fallbackTileClass } from './fallbackField.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * The prep camera's frame (render/projection.js `prep` rect, also render/app.js camRect): bench row 7 through
 * deploy rows 9–12, columns 0–10 inclusive. That is the player's half. The partner half (columns 11–20), the boss
 * field and the pen stay out.
 * [ASSUMED] the briefing thumbnail uses this frame. The official one is a 3D render of the scene, and no such
 * picture is in the manifests, so the cells stand in for it.
 * Row 0 is the bottom of the stage (shared/constants.js GEO). Cells are listed far-row first so the bench is at
 * the bottom of the thumbnail.
 */
export const STAGE_PREVIEW_CROP = Object.freeze({ r0: 7, r1: 12, c0: 0, c1: 10 });

/** [ASSUMED] The magnifier is a control that opens a larger copy, not a decoration. */
export const STAGE_PREVIEW_ZOOM = 'dialog';

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
 * Official picture if a manifest already lists one, otherwise the cell drawing.
 * @param {{ ui?: Record<string, string>|null, localGroups?: Record<string, any>|null }} src
 * @param {string} stageId
 * @returns {{ kind: 'picture', url: string, key: string } | { kind: 'cells', assumed: true }}
 */
export function stagePreviewChoice(src, stageId) {
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
  return { kind: 'cells', assumed: true };
}

function cellClass(cell) {
  const extra = cell.special && cell.special !== cell.kind && /^[A-Za-z][A-Za-z0-9]*$/.test(cell.special)
    ? `reg-map__cell--${cell.special}` : '';
  return cx('reg-map__cell', `ff-tile--${cell.kind}`, extra);
}

function cellsView(cells, cols, cls) {
  return html`<div class=${cx('reg-map', cls)} data-preview="cells" data-assumed="true"
    style=${`grid-template-columns:repeat(${cols},minmax(0,1fr))`}>
    ${cells.map((c) => html`<i key=${`${c.row}-${c.col}`} class=${cellClass(c)} data-kind=${c.kind} data-row=${c.row} data-col=${c.col} data-special=${c.special || undefined}></i>`)}
  </div>`;
}

/**
 * The thumbnail. A picture uses Img and falls back to the cells when the file fails. Hookless.
 * @param {{ stage: any, choice: ReturnType<typeof stagePreviewChoice>, class?: string }} props
 */
export function StageMap({ stage, choice, class: cls }) {
  const cells = stagePreviewCells(stage);
  const cols = STAGE_PREVIEW_CROP.c1 - STAGE_PREVIEW_CROP.c0 + 1;
  if (choice?.kind === 'picture' && choice.url) {
    return html`<div class=${cx('reg-map', 'reg-map--pic', cls)} data-preview="picture" data-key=${choice.key}>
      <${Img} src=${choice.url} class="reg-map__img" alt="" fallback=${cellsView(cells, cols)} />
    </div>`;
  }
  return cellsView(cells, cols, cls);
}

/**
 * Thumbnail plus the magnifier. The dialog repeats the stage name and the pool (战场固定 / 战场随机).
 * Uses state: unit tests read the vnode, they do not call this.
 * @param {{ stage: any, choice: ReturnType<typeof stagePreviewChoice>, name?: string, pool?: string }} props
 */
export function StagePreview({ stage, choice, name, pool }) {
  const [open, setOpen] = useState(false);
  const label = t('查看战场「{name}」', { name: name || '—' });
  return html`<div class="reg-stage">
    <div class="reg-preview">
      <${StageMap} stage=${stage} choice=${choice} />
      <button type="button" class="reg-preview__zoom" aria-label=${label} onClick=${() => setOpen(true)}>
        <${Icon} name="search" />
      </button>
    </div>
    <${Modal} open=${open} onClose=${() => setOpen(false)} class="reg-mapdlg" title=${t('本局战场')} micro="BATTLEFIELD"
      actions=${html`<${Button} variant="secondary" icon="close" onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <p class="reg-mapdlg__name"><b>${name || '—'}</b>${pool ? html`<span>${pool}</span>` : null}</p>
      <${StageMap} stage=${stage} choice=${choice} class="reg-map--lg" />
    <//>
  </div>`;
}
