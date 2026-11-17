// 皮肤选择器 (docs/SKINS.md) — the 皮肤 section of the 干员调配 screen's detail panel.
//
// Self-contained on purpose: screens/loadout.js and screens/diy.js only import this and drop
// `<${SkinSection} charId=… />` into their detail body, so upstream rewriting one of those screens (they are the two
// files most likely to change) costs one line rather than a merge conflict over a whole panel.
//
// Where the rows come from: ui/skins.js availableSkins, i.e. the COMPOSED asset manifest (`chars[<charId>].skins`,
// written by a cosmetic plugin's overlay — docs/PLUGINS.md §9). There is no catalogue file and no installer here: a
// wearable skins have a model or pictures; picture-only outfits keep the default battle model (B6).
//
// The section's display rule (docs/SKINS.md) is GLOBAL and comes from ui/skins.js `hasAnySkinChoices`:
//   * no operator has a wear-able skin (no plugin, no skins records, or only metadata-only skins) —
//     the section is left out, header included, so an installation without a cosmetic layer looks exactly as before;
//   * at least one operator has one — EVERY operator shows the section. An operator without a skin of its own gets the
//     默认 tile alone, with a real picture on it.
// The rule used to be per operator (`hasSkinChoices`: 默认 plus a wear-able skin of THIS operator). It is deliberately
// the other way round now, and must not be turned back: a section that appears only for the operators a plugin wrote a
// skin for cannot be told apart from a plugin that failed to load. A lone 默认 tile is no choice, but it is the proof
// that the plugin is on and this operator has no 时装 — which is worth more than the operator looking untouched.
// A missing piece of art still falls back to the OPERATOR's own (its 立绘 / portrait / avatar), never to a slash or a
// placeholder, so the 默认 tile of a picture-only plugin draws the picture that plugin wrote.

import { useState } from '../../vendor/hooks.module.js';
import { html, MicroLabel, Modal } from './components.js';
import { useStore } from '../store.js';
import { useData } from '../data.js';
import { skinsStore, availableSkins, chosenSkin, hasAnySkinChoices, setSkin, clearSkin, SKINS_KEY } from './skins.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * One tile of the grid: the 默认 appearance of the operator (which has real art of its own) or one of its skins.
 *
 * The art is a FIXED 1:2 box (the shape of the client's 180×360 portrait, the "big icon" an appearance is chosen by),
 * and `availableSkins` has already resolved which URL fills it — the skin's own portrait, else the operator's. A tile
 * whose art is the operator's own is marked with `is-fallback`, purely for the style of a mixed row.
 *
 * The SAME appearance's 1:1 `avatar` rides along in the same box (`row.face`): CSS keeps it undrawn while the 1:2 box
 * fits and draws it instead on a panel too short for that box (a phone in landscape — css/screens/loadout.css). Both
 * images are in the DOM, so the choice costs no resize listener and no re-render. A row of a manifest that gives the
 * operator no avatar at all has no second image and keeps its portrait everywhere.
 * @param {{ row: any, chosen: boolean, onPick: () => void, onPreview: () => void }} props
 */
function SkinTile({ row, chosen, onPick, onPreview }) {
  const isDefault = row.own;
  const title = isDefault ? t('干员本体，不使用时装') : chosen ? t('点击放大预览') : t('点击选择这套外观');
  return html`<button type="button" role="radio" aria-checked=${chosen ? 'true' : 'false'} data-skin=${row.id}
      class=${cx('lo-skin', isDefault && 'lo-skin--default', chosen && 'is-on', row.fallbackArt && 'lo-skin--fallback')}
      title=${title} onClick=${() => (chosen && !isDefault ? onPreview() : onPick())}>
    <span class=${cx('lo-skin__art', row.face && 'lo-skin__art--face')}>
      ${row.art
        ? html`<img class="lo-skin__art--big" src=${row.art} alt="" loading="lazy" />`
        : null}
      ${row.face
        ? html`<img class="lo-skin__art--faceimg" src=${row.face} alt="" loading="lazy" />`
        : null}
      ${!row.art && !row.face
        ? html`<span class="lo-skin__art--none"></span>`
        : null}
    </span>
    <span class="lo-skin__text">
      <b class="lo-skin__name">${isDefault ? t('默认') : row.name}</b>
      <span class="lo-skin__group">${isDefault ? 'DEFAULT' : row.group || t('时装')}</span>
      ${row.pictureOnly ? html`<span class="lo-skin__note">${t('仅更换头像与立绘')}</span>` : null}
    </span>
  </button>`;
}

/**
 * The enlarged preview of one appearance: its 立绘 (the whole picture, not the cropped tile) inside a modal.
 * A plain component taking a URL rather than reading the store, so its markup can be tested without a browser.
 * @param {{ art?: string|null, name?: string }} props
 */
export function SkinPreview({ art = null, name = '' }) {
  if (!art) return null;
  return html`<div class="lo-skin-preview"><img src=${art} alt=${name} /></div>`;
}

/**
 * 皮肤 section for one operator of the panel being shown (`screens/loadout.js` 干员调配 or `screens/diy.js` 自选编队).
 *
 * Whether it exists is decided GLOBALLY, not for the operator passed in: `hasAnySkinChoices()` (see the header and
 * docs/SKINS.md). Once it does exist this operator gets its 默认 tile and whatever wear-able skins the manifest has for
 * it — one tile for an operator without a skin, which is the intended reading, not a bug.
 *
 * Keyed by the OPERATOR id (`chess.charId`), not by a chess id: `chars[<charId>].skins` is the manifest's own grouping,
 * and one operator's normal, elite and 自选 pieces are the same operator, so one entry covers all three (the server's
 * `ps.skins[charId]` agrees — server/match/match/views.js `skinFor`). That is also why the panel needs nothing but the
 * charId: a 自选 slot passes the operator its pick fields.
 * @param {{ charId: string }} props
 */
export function SkinSection({ charId }) {
  // the choice (this module's store) and the composed manifest (the catalogue): either can change while the panel is
  // open — the player picks a skin, a plugin's document lands, a layer is switched off
  const s = useStore((v) => v, Object.is, skinsStore);
  const ready = useData('assets');
  const [preview, setPreview] = useState(null);

  const id = typeof charId === 'string' && charId ? charId : null;
  if (!id || !ready) return null;
  // the GLOBAL gate (docs/SKINS.md): shown for every operator as soon as any operator of the manifest has a wear-able
  // skin, and for none while none has. A per-operator gate lived here and was removed on purpose — see the header.
  if (!hasAnySkinChoices()) return null;
  const rows = availableSkins(id).filter((x) => x.own || x.playable);
  // an operator the composed manifest does not hold at all has nothing to draw — not even a 默认 tile — so it gets no
  // section rather than an empty grid: the global rule can only show what the manifest has
  if (!rows.length) return null;
  const chosen = chosenSkin(id, s[SKINS_KEY]);
  // the tile art of a row is already resolved (its own portrait, else the operator's); `face` is the same appearance's
  // 1:1 avatar, which CSS draws instead of the 1:2 art when the panel is too short for it. The enlarged preview prefers
  // the 立绘 — a 1024 px+ picture — and is only offered for a skin (the 默认 tile's own portrait is not a poster)
  const shown = rows.map((row) => ({ ...row, art: row.portrait || row.avatar || null, face: row.avatar || null }));
  const previewRow = preview ? rows.find((x) => !x.own && x.id === preview) || null : null;
  const previewArt = previewRow ? (previewRow.illust || previewRow.portrait || previewRow.avatar) : null;

  return html`<section class="lo-sec lo-sec--skin" data-testid="skin-section">
    <header class="lo-sec__head">
      <h3>${t('皮肤')}<${MicroLabel}>SKIN<//></h3>
      ${/* always the count, 0 included ("0 套外观"): with the global rule an operator that has no skin of its own gets
            this section with the 默认 tile alone, and the count is what says the plugin is on and this operator simply
            has no 时装 — omitting it would leave the header looking like an empty section. One branch fewer, too. */ null}
      <span class="lo-sec__note">${t('{n} 套外观', { n: shown.length - 1 })}</span>
    </header>
    <div class="lo-skins" role="radiogroup" aria-label=${t('选择皮肤')}>
      ${shown.map((row) => html`<${SkinTile} key=${row.own ? 'default' : row.id} row=${row} chosen=${row.own ? !chosen : chosen === row.id}
        onPick=${() => (row.own ? clearSkin(id) : setSkin(id, row.id))} onPreview=${() => setPreview(row.id)} />`)}
    </div>
    <${Modal} open=${!!previewRow} title=${previewRow ? previewRow.name : t('外观预览')} micro="SKIN PREVIEW"
      onClose=${() => setPreview(null)} width="min(92vw, 900px)">
      <${SkinPreview} art=${previewArt} name=${previewRow ? previewRow.name : ''} />
    <//>
  </section>`;
}

