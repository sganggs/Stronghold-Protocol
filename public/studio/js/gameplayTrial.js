import { html, Button } from '../../js/ui/components.js';
import { t } from '../../../shared/i18n.js';
import { NumberField, Select } from './editors/controls.js';
import { gameplayHooks } from './gameplayModel.js';
import { Toggle } from './editors/gameplayControls.js';

export function GameplayExercise({ template, value, onChange, result, busy, onAction }) {
  return html`<fieldset data-testid="gameplay-exercise"><legend>${t('玩法试验')}</legend>
    <p class="st-note">${t('独立事件试验：盟约直接激活，准备钩子执行一次；完整经济流程请在房间测试。')}</p>
    <${NumberField} label=${t('回合')} value=${value.round} min=${1} max=${99} step=${1} onChange=${round => onChange({ ...value, round })} />
    ${gameplayHooks(template).length ? html`<${Select} label=${t('触发器')} value=${value.hook || ''} options=${[{ id: '', name: t('自动') }, ...gameplayHooks(template)]} onChange=${hook => onChange({ ...value, hook })} />` : null}
    ${template === 'item' ? html`<${Toggle} label=${t('精锐')} value=${value.elite} onChange=${elite => onChange({ ...value, elite })} />` : null}
    ${template === 'offers' ? html`<${Select} label=${t('窗口时机')} value=${value.at} options=${['prep', 'battleCheck']} onChange=${at => onChange({ ...value, at })} />` : null}
    ${result ? html`<p>${result.blocking ? t('窗口正在阻塞') : t('窗口未阻塞')}</p>
      ${result.windows.map(w => html`<fieldset><legend>${w.id} · ${w.windowSec}s</legend>
        ${(w.seats.find(s => s.playerId === 'studio')?.slots || []).map(slot => html`<div class="st-inline">
          <span>${slot.name} · ${slot.desc}</span>
          <${Button} size="sm" disabled=${busy || !slot.available} onClick=${() => onAction({ kind: 'pick', id: w.id, pluginId: w.pluginId, idx: slot.idx, cardId: slot.id })}>${t('选择')}<//>
          <${Button} size="sm" disabled=${busy || slot.remaining < 1} onClick=${() => onAction({ kind: 'refresh', id: w.id, pluginId: w.pluginId, idx: slot.idx, cardId: slot.id })}>${t('刷新')} (${slot.remaining})<//>
        </div>`)}
      </fieldset>`)}
      ${result.windows.length ? html`<${Button} size="sm" disabled=${busy} onClick=${() => onAction({ kind: 'timeout' })}>${t('推进到超时')}<//>` : null}
      <table class="st-table"><thead><tr><th></th><th>${t('之前')}</th><th>${t('之后')}</th></tr></thead>
        <tbody>${['funds', 'pendingFunds', 'freeRefresh', 'layers', 'inventory', 'rules'].map(key => html`<tr><th>${key}</th><td>${JSON.stringify(result.before[key])}</td><td>${JSON.stringify(result.after[key])}</td></tr>`)}</tbody></table>
      ${result.ruleChecks ? html`<table class="st-table"><thead><tr><th></th><th>${t('原版')}</th><th>${t('插件')}</th></tr></thead>
        <tbody>${result.ruleChecks.map(check => html`<tr><th>${check.rule}</th><td><pre>${JSON.stringify(result.reference?.find(r => r.rule === check.rule), null, 2)}</pre></td><td><pre>${JSON.stringify(check, null, 2)}</pre></td></tr>`)}</tbody></table>` : null}
      ${result.outcomes.some(r => !r.ok) ? html`<p class="st-error">${t('操作被拒绝')} · ${JSON.stringify(result.outcomes.filter(r => !r.ok))}</p>` : null}` : null}
  </fieldset>`;
}
