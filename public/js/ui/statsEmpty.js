// Keep the ranking frames visible without inventing record entries.
import { html } from './components.js';
import { Img } from './gameComponents.js';
import { uiUrl } from './assetUrls.js';
import { t } from '../../../shared/i18n.js';

export function EmptyTopRecords({ kind, manifest }) {
  const bond = kind === 'bond';
  const cls = bond ? 'st-top-bond' : 'st-top-strategy';
  return html`<div class=${bond ? 'st-top-bonds' : 'st-top-strategies'} aria-hidden="true">
    ${[1, 2, 3].map(rank => html`<div key=${rank} class=${`${cls} is-empty`}>
      <div class=${`${cls}__art`}>
        <${Img} src=${uiUrl(manifest, bond ? 'statistics/bondTopFrame' : 'statistics/strategyTopFrame')} class=${bond ? 'st-bond-frame' : 'st-strategy-frame'} />
        <span class=${`${cls}__rank`}>${t('TOP{n}', { n: rank })}</span>
      </div>
    </div>`)}
  </div>`;
}
