import { useEffect, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { data } from '../../../js/data.js';
import { t } from '../../../../shared/i18n.js';
import { TargetPicker } from '../picker.js';
import { get, post } from '../api.js';
import { validateDraft } from '../validateDraft.js';
import { IssueList } from '../issues.js';
import { Field, Select } from './controls.js';

export const Toggle = ({ label, value, onChange, disabled = false }) => html`<label class="st-check"><input type="checkbox" disabled=${disabled} checked=${!!value} onChange=${e => onChange(e.currentTarget.checked)} />${label}</label>`;
export const LongText = ({ label, value, onChange, max = 8192 }) => html`<${Field} label=${label}><textarea class="st-input" value=${value || ''} maxLength=${max} onInput=${e => onChange(e.currentTarget.value)} /><//>`;
export const removeAt = (xs, i) => xs.filter((_, n) => n !== i);
export const replaceAt = (xs, i, value) => xs.map((x, n) => i === n ? value : x);

/** Reuse official-name search; item/chess art targets are resolved to actual gameplay record IDs. */
export function RecordPicker({ kind, value, onChange, label, table = null, localBond = null }) {
  const records = table || data.get(kind === 'chess' ? 'chess' : kind === 'item' ? 'items' : kind === 'bond' ? 'bonds' : 'backups') || {};
  const name = records[value]?.name || records.units?.[value]?.name || value;
  const [open, setOpen] = useState(false);
  const [forms, setForms] = useState([]);
  const pick = target => {
    const variants = ['item', 'chess'].includes(kind) ? Object.values(records).filter(r => kind === 'item'
      ? r.iconId === target.key || r.id === target.key : r.charId === target.key && !r.isDiy) : [];
    setForms(variants.map(r => ({ id: r.chessId || r.id, name: `${r.name} · ${r.isGolden ? t('精锐') : t('普通')}` })));
    onChange(variants.find(r => !r.isGolden)?.chessId || variants.find(r => !r.isGolden)?.id || target.key);
    setOpen(false);
  };
  return html`<div class="st-field-row"><span>${label}</span><span>${name || t('无')}</span>
    <button type="button" class="st-link-btn" onClick=${() => setOpen(!open)}>${t('选择')}</button>
    ${open ? html`<${TargetPicker} kinds=${[kind === 'chess' ? 'operator' : kind]} onPick=${pick} />` : null}
    ${forms.length > 1 ? html`<${Select} label=${t('形态')} value=${value} options=${forms} onChange=${onChange} />` : null}
    ${localBond ? html`<${Select} label=${t('本插件盟约')} value=${value} options=${[{ id: value, name: name || value }, ...(value === localBond.id ? [] : [localBond])]} onChange=${onChange} />` : null}
  </div>`;
}

export function DraftValidation({ draft }) {
  const [result, setResult] = useState(null);
  const signature = JSON.stringify(draft);
  useEffect(() => {
    let live = true;
    setResult(null);
    const timer = setTimeout(() => validateDraft(draft, { get, post }).then(r => { if (live) setResult(r); })
      .catch(() => { if (live) setResult({ failed: true }); }), 300);
    return () => { live = false; clearTimeout(timer); };
  }, [signature]);
  return html`<div class=${`st-banner ${result?.ok ? 'is-ok' : 'is-warn'}`} aria-live="polite" data-testid="gameplay-validation">
    ${!result ? t('正在校验…') : result.failed ? t('校验或保存未完成，请重试。') : result.ok ? t('校验通过')
      : html`<${IssueList} issues=${result.problems.map(p => ({ ...p, level: 'problem', text: p.message, params: { ...p.params, where: p.path, detail: p.message } }))} />`}
  </div>`;
}
