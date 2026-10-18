import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { validatePresentation } from '../presentation.js';
import { IssueList } from '../issues.js';
import { Field } from './controls.js';

export function PresentationIssues({ draft }) {
  const result = validatePresentation(draft);
  return html`<div aria-live="polite" data-testid="presentation-validation"><${IssueList} compact=${true} issues=${result.problems.map(p => ({
    level: 'problem', code: p.code, text: p.message, at: p.at, params: { where: p.path, detail: p.message },
  }))} /></div>`;
}
export function Line({ label, value, onChange, maxLength = 64, type = 'text' }) {
  return html`<${Field} label=${label}><input class="st-input" type=${type} value=${value || ''} maxLength=${maxLength} onInput=${e => onChange(e.currentTarget.value)} /><//>`;
}
export function Body({ label, value, onChange }) {
  return html`<${Field} label=${label}><textarea class="st-input st-presentation-body" value=${value || ''} onInput=${e => onChange(e.currentTarget.value)} /><//>`;
}
export function Upload({ label, accept, multiple = false, disabled, onFiles }) {
  return html`<${Field} label=${label}><input class="st-input" type="file" accept=${accept} multiple=${multiple} disabled=${disabled}
    onChange=${e => { const files = [...e.currentTarget.files]; e.currentTarget.value = ''; if (files.length) onFiles(files); }} /><//>`;
}
export function SaveMediaNote({ dirty }) { return dirty ? html`<p class="st-note">${t('先保存表单，再上传或清除素材。')}</p>` : null; }
