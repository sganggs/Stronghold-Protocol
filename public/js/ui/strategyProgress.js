import { html } from './components.js';
import { t } from '../../../shared/i18n.js';

const label = p => Number.isInteger(p?.current) && p.current >= 0 && Number.isInteger(p.total) && p.total > 0
  ? `${p.current} / ${p.total}` : '';

/** The same read-only progress in the effect badge, tooltip and strategy details. */
export function strategyProgressModel(effect) {
  const progress = label(effect?.progress);
  if (!progress) return null;
  const rewards = label(effect.roundProgress);
  const lines = [[t('主动刷新'), progress]];
  if (rewards) lines.push([t('本回合获得'), rewards]);
  return {
    badge: rewards && effect.roundProgress.current >= effect.roundProgress.total ? t('本回合已满') : progress,
    lines,
  };
}

export function StrategyProgress({ effect }) {
  const model = strategyProgressModel(effect);
  return model ? html`<div class="strategy-progress">${model.lines.map(([name, value]) =>
    html`<p key=${name}>${name} <strong class="num">${value}</strong></p>`)}</div>` : null;
}
