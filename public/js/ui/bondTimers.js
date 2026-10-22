// #746: selected-unit convenience readout. [ASSUMED] Labels, next-expiry summary and tenth-second precision.
// Times arrive with simulation snapshots: deliberately no client clock or interpolation, including during pause.
import { BOND_TIMERS } from '../../../shared/bondTimers.js';
import { t } from '../../../shared/i18n.js';
import { html } from './components.js';

export function selectedBondTimers(snap, fieldId, unitId) {
  if (!snap || snap.fieldId !== fieldId || unitId == null || !snap.units?.some(u => u[0] === unitId && u[3] > 0)) return [];
  return snap.bondTimers?.find(row => row[0] === unitId)?.[1] || [];
}

export function BondTimers({ rows = [] }) {
  const active = BOND_TIMERS.flatMap(d => {
    const r = rows.find(row => row.id === d.id);
    if (!r || !Number.isInteger(r.count) || r.count <= 0 || !Number.isFinite(r.remaining) || r.remaining <= 0) return [];
    return [{ d, r }];
  });
  if (!active.length) return null;
  return html`<section class="dsec dbond-times" aria-label=${t('盟约效果剩余时间')}>
    <h4 class="dsec__title">${t('盟约效果剩余时间')}</h4>
    ${active.map(({ d, r }) => html`<div class="dbond-times__row" key=${d.id} data-effect=${d.id}>
      <span>${t(d.label)}</span><span class="num">${d.stacked
        ? t('{n} 层 · 下一层 {s} 秒', { n: r.count, s: r.remaining.toFixed(1) })
        : t('剩余 {s} 秒', { s: r.remaining.toFixed(1) })}</span>
    </div>`)}
  </section>`;
}
