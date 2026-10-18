import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { gameplayOptions, editGameplay } from '../gameplayModel.js';
import { Toggle, LongText, RecordPicker, DraftValidation } from './gameplayControls.js';
import { DslRules } from './dslForm.js';

export function TraitEditor({ draft, onChange }) {
  const o = gameplayOptions(draft);
  const charId = draft.options.charId || draft.target?.replace(/^operator:/, '') || o.charId;
  const change = patch => onChange(editGameplay(draft, { charId, ...patch }));
  return html`<div class="st-form" data-testid="trait-editor">
    <${RecordPicker} kind="operator" label=${t('干员')} value=${charId} onChange=${charId => change({ charId })} />
    <${Toggle} label=${t('明确替换官方特质')} value=${o.override} onChange=${override => change({ override })} />
    <${LongText} label=${t('特质文本（中文）')} value=${o.desc} onChange=${desc => change({ desc })} />
    ${['en', 'ja', 'ko', 'zh-TW'].map(lang => html`<${LongText} label=${lang} value=${o.translations[lang] || ''} onChange=${value => change({ translations: { ...o.translations, [lang]: value } })} />`)}
    <h4>${t('天赋')}</h4><${DslRules} trait=${true} value=${o.spec.talents} onChange=${talents => change({ spec: { ...o.spec, talents } })} />
    <h4>${t('备战效果')}</h4><${DslRules} trait=${true} meta=${true} value=${o.spec.meta?.on} onChange=${on => change({ spec: { ...o.spec, meta: { on } } })} />
    <${DraftValidation} draft=${draft} />
  </div>`;
}
export default { id: 'trait', Component: TraitEditor };
