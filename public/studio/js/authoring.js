import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button } from '../../js/ui/components.js';
import { t } from '../../../shared/i18n.js';
import { get, post } from './api.js';
import { errorText } from './issues.js';
import { validateDraft } from './validateDraft.js';
import { editorOf } from './editors/index.js';
import { SlotCard } from './slots.js';

export function Authoring({ state, busy, onSave, onDraft, initialDraft, slotActions }) {
  const [draft, setDraft] = useState(initialDraft || { ...state.authoring, id: state.id });
  const [pendingReads, setPendingReads] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const baseline = JSON.stringify(state.authoring);
  useEffect(() => { const next = initialDraft?.revision === state.authoring.revision ? initialDraft : { ...state.authoring, id: state.id }; setDraft(next); onDraft(next); }, [baseline]);
  const Component = editorOf(draft.template).Component;
  const change = update => { setFailure(''); setDraft(previous => { const next = typeof update === 'function' ? update(previous) : update; onDraft(next); return next; }); };
  const dirty = JSON.stringify({ ...draft, id: undefined }) !== baseline;
  const save = async () => {
    if (pendingReads) return;
    setSaving(true); setFailure('');
    try {
      const result = await validateDraft(draft, { get, post });
      if (!result.ok) { setFailure(result.problems?.map(p => `${p.path || ''}: ${p.message || p.code}`).join('\n') || t('校验未通过，请修正表单中的问题。'));  return; }
      const saved = await onSave(draft);
      if (!saved?.check?.ok) setFailure(t('校验或保存未完成，请重试。'));
    } catch (e) { setFailure(t('校验或保存未完成，请重试。') + ' ' + errorText(e)); }
    finally { setSaving(false); }
  };
  return html`<section class="st-authoring" data-testid="authoring">
    ${Component ? html`<${Component} draft=${draft} state=${state} onChange=${change} onPendingRead=${delta => setPendingReads(n => n + delta)} slotActions=${slotActions} SlotComponent=${SlotCard} onFiles=${slotActions?.onFiles} onClear=${slotActions?.onClear} dirty=${dirty} busy=${busy || saving || (dirty && draft.template !== 'fx')} />` : null}
    ${failure ? html`<p class="st-error" data-testid="authoring-error">${failure}</p>` : null}
    ${draft.template !== 'script' ? html`<${Button} variant="primary" data-testid="save-wizard" disabled=${busy || saving || pendingReads > 0 || !dirty} loading=${busy || saving} onClick=${save}>${t('保存修改')}<//>` : null}
  </section>`;
}
