// Square portraits for the bond card; independent of UnitThumb's cut-corner frame.
import { html } from './components.js';
import { Img, OperatorImage } from './gameComponents.js';
import { uiUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

export function BondMemberThumb({ id, rec = null, ownerId, dim = false, title }) {
	const chess = rec || data.lookup('chess', id);
	const name = title ?? chess?.name ?? '';
	const tier = Math.max(1, Math.min(6, Number(chess?.tier) || 1));
	const tierKey = `bondChar/img_chess_level_${tier}`;
	const manifest = data.get('assets');
	const standIn = rec && typeof rec.standInFor === 'string' && rec.standInFor;
	return html`<span class=${['bond-thumb', dim && 'is-dim', chess?.isGolden && 'is-golden'].filter(Boolean).join(' ')}
		style=${`--bond-tier-color: var(--tier-${tier})`} title=${name}>
		<span class="bond-thumb__art">
			<${OperatorImage} m=${manifest} chess=${chess} ownerId=${ownerId}
				fallback=${html`<span class="bond-thumb__glyph">${[...(name || '?')][0]}</span>`} />
		</span>
		<${Img} class="bond-thumb__tier" src=${uiUrl(manifest, tierKey) || `/assets/ui/${tierKey}.png`} />
		${standIn ? html`<span class="bond-thumb__standin" aria-hidden="true">${t('替补')}</span>` : null}
	</span>`;
}
