// public/studio/js/preview/cards.js — pictures in the game's own interface, original beside plugin (DESIGN §32.9): an
// operator's card picture (ui/gameComponents.js UnitThumb — the shop, the bench, the 干员调配 card), its E2 one, and its
// portrait in the detail card (ui/detailPanel.js ChessDetail) — drawn through data.js's view of `assets` (the preview
// layers: the plugin's entry under `<key>~plugin`, ./layers.js); a summon's card; and for every other picture (an
// enemy's icon, an item's, a bond's, a strategy's, an interface picture) the two images side by side.

import { useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { UnitThumb, Img } from '../../../js/ui/gameComponents.js';
import { ChessDetail } from '../../../js/ui/detailPanel.js';
import { data } from '../../../js/data.js';
import { t } from '../../../../shared/i18n.js';
import { getPath } from '../../../../shared/plugins/visual.js';
import { PLUGIN_SUFFIX, pluginRecord } from './layers.js';

const cx = (...p) => p.filter(Boolean).join(' ');

/** Two columns, 原版 and 插件. */
function Pair({ label, left, right, testid }) {
  return html`<div class="st-pair" data-testid=${testid}>
    ${label ? html`<div class="st-pair__label">${label}</div>` : null}
    <div class="st-pair__cols">
      <figure class="st-pair__col"><div class="st-pair__art">${left}</div><figcaption>${t('原版')}</figcaption></figure>
      <figure class="st-pair__col is-plugin"><div class="st-pair__art">${right}</div><figcaption>${t('插件')}</figcaption></figure>
    </div>
  </div>`;
}

/** An image of the manifest at a path, or a placeholder. */
function Pic({ src, alt = '' }) {
  return src ? html`<${Img} class="st-pic" src=${src} alt=${alt} fallback=${html`<div class="st-pic is-none">${t('无图')}</div>`} />` : html`<div class="st-pic is-none">${t('无图')}</div>`;
}

/**
 * The picture previews of a target (see the header).
 * @param {{ target: any, version: number }} props version: changes with every new preview (re-render)
 */
export function CardPreview({ target, version }) {
  const m = data.get('assets');
  const [e2, setE2] = useState(false);
  void version;
  if (target.kind === 'operator') {
    const chess = data.list('chess').find((c) => c && c.charId === target.key && !!c.isGolden === e2)
      || data.list('chess').find((c) => c && c.charId === target.key) || null;
    if (!chess) {
      // an operator without a shop chess (补位 / 自选): its pictures as they are
      return html`<div class="st-cards">
        <${Pair} label=${t('头像')} testid="pair-avatar" left=${html`<${Pic} src=${getPath(m, ['chars', target.key, 'avatar'])} />`} right=${html`<${Pic} src=${getPath(m, ['chars', `${target.key}${PLUGIN_SUFFIX}`, 'avatar'])} />`} />
        <${Pair} label=${t('立绘')} testid="pair-portrait" left=${html`<${Pic} src=${getPath(m, ['chars', target.key, 'portrait'])} />`} right=${html`<${Pic} src=${getPath(m, ['chars', `${target.key}${PLUGIN_SUFFIX}`, 'portrait'])} />`} />
      </div>`;
    }
    const plugin = pluginRecord(chess, target.key);
    return html`<div class="st-cards">
      <div class="st-cards__bar">
        <div class="st-seg" role="group" aria-label=${t('精英化')}>
          <button type="button" class=${cx('st-seg__btn', !e2 && 'is-on')} onClick=${() => setE2(false)}>${t('普通')}</button>
          <button type="button" class=${cx('st-seg__btn', e2 && 'is-on')} onClick=${() => setE2(true)}>${t('精锐（精英二）')}</button>
        </div>
      </div>
      <${Pair} label=${t('卡片头像（商店、整备区、干员调配）')} testid="pair-thumb"
        left=${html`<${UnitThumb} kind="chess" ownerId=${null} id=${chess.chessId} rec=${chess} size="lg" />`}
        right=${html`<${UnitThumb} kind="chess" ownerId=${null} id=${chess.chessId} rec=${plugin} size="lg" />`} />
      <${Pair} label=${t('详情卡（立绘）')} testid="pair-detail"
        left=${html`<div class="st-dcard dpanel"><div class="dpanel__scroll"><${ChessDetail} ownerId=${null} chess=${chess} /></div></div>`}
        right=${html`<div class="st-dcard dpanel"><div class="dpanel__scroll"><${ChessDetail} ownerId=${null} chess=${plugin} /></div></div>`} />
    </div>`;
  }
  if (target.kind === 'token') {
    return html`<div class="st-cards">
      <${Pair} label=${t('头像')} testid="pair-avatar" left=${html`<${UnitThumb} kind="token" id=${target.key} size="lg" />`} right=${html`<${UnitThumb} kind="token" id=${`${target.key}${PLUGIN_SUFFIX}`} size="lg" />`} />
    </div>`;
  }
  const at = target.kind === 'enemy' ? ['enemies', target.key, 'icon'] : [...target.container, target.key];
  const pat = target.kind === 'enemy' ? ['enemies', `${target.key}${PLUGIN_SUFFIX}`, 'icon'] : [...target.container, `${target.key}${PLUGIN_SUFFIX}`];
  return html`<div class="st-cards">
    <${Pair} label=${t('图标')} testid="pair-icon" left=${html`<${Pic} src=${getPath(m, at)} />`} right=${html`<${Pic} src=${getPath(m, pat)} />`} />
  </div>`;
}
