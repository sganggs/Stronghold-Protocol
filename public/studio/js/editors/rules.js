import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { RULE_NAMES, RULE_SWITCHES } from '../../../../shared/plugins/rules.js';
import { gameplayOptions, editGameplay } from '../gameplayModel.js';
import { Select } from './controls.js';
import { DraftValidation } from './gameplayControls.js';

export function RulesEditor({ draft, onChange }) {
  const o = gameplayOptions(draft);
  return html`<div class="st-form" data-testid="rules-editor">
    ${RULE_NAMES.map(name => html`<div><${Select} label=${name} value=${o.rules[name] || ''}
      options=${[{ id: '', name: t('继承') }, ...RULE_SWITCHES[name].options.map(id => ({ id, name: id }))]}
      onChange=${value => { const rules = { ...o.rules }; if (value) rules[name] = value; else delete rules[name]; onChange(editGameplay(draft, { rules })); }} />
      <p class="st-note">${t(Object.values(RULE_SWITCHES[name].phrase)[0])}</p></div>`)}
    <${DraftValidation} draft=${draft} />
  </div>`;
}
export default { id: 'rules', Component: RulesEditor };
