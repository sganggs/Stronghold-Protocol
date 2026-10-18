import { html, Button } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { bondId, gameplayOptions, editGameplay } from '../gameplayModel.js';
import { NumberField, Select, TextField } from './controls.js';
import { Toggle, LongText, RecordPicker, removeAt, replaceAt, DraftValidation } from './gameplayControls.js';
import { DslRules } from './dslForm.js';
import art from './art.js';

export function BondEditor({ draft, onChange, state, slotActions, busy, SlotComponent }) {
  const o = gameplayOptions(draft), change = patch => onChange(editGameplay(draft, patch));
  const bid = bondId(draft.id);
  return html`<div class="st-form" data-testid="bond-editor">
    <${TextField} label=${t('名字')} value=${o.name} onChange=${name => change({ name })} />
    <${LongText} label=${t('描述')} value=${o.desc} onChange=${desc => change({ desc })} />
    <${Select} label=${t('计数方式')} value=${o.countMode} options=${['BOARD', 'BOARD_AND_DECK', 'BOARD_ALL_CHESS']} onChange=${countMode => change({ countMode })} />
    <${Toggle} label=${t('核心盟约')} value=${o.isCore} onChange=${isCore => change({ isCore })} />
    <fieldset><legend>${t('激活门槛')}</legend>${o.thresholds.map((v, i) => html`<div>
      <${NumberField} label=${String(i + 1)} value=${v} min=${1} max=${100} step=${1} onChange=${n => change({ thresholds: replaceAt(o.thresholds, i, n) })} />
      <${Button} size="sm" disabled=${o.thresholds.length === 1} onClick=${() => change({ thresholds: removeAt(o.thresholds, i) })}>${t('删除')}<//></div>`)}
      <${Button} size="sm" disabled=${o.thresholds.length >= 16} onClick=${() => change({ thresholds: [...o.thresholds, o.thresholds.at(-1) + 1] })}>${t('添加')}<//>
    </fieldset>
    <${NumberField} label=${t('效果所需层级')} value=${o.effectTier} min=${1} max=${o.thresholds.length} step=${1} onChange=${effectTier => change({ effectTier })} />
    <fieldset><legend>${t('成员')}</legend>${o.members.map((value, i) => html`<div>
      <${RecordPicker} kind="operator" label=${t('干员')} value=${value} onChange=${v => change({ members: replaceAt(o.members, i, v) })} />
      <${Button} size="sm" onClick=${() => change({ members: removeAt(o.members, i) })}>${t('删除')}<//></div>`)}
      ${o.members.length < 64 ? html`<${RecordPicker} kind="operator" label=${t('添加成员')} value="" onChange=${v => change({ members: [...new Set([...o.members, v])] })} />` : null}
    </fieldset>
    <h4>${t('备战效果')}</h4><${DslRules} localBond=${{ id: bid, name: o.name }} meta=${true} value=${o.prep} onChange=${prep => change({ prep })} />
    <h4>${t('天赋')}</h4><${DslRules} localBond=${{ id: bid, name: o.name }} value=${o.talents} onChange=${talents => change({ talents })} />
    <p class="st-note">${t('效果自动以本盟约激活为条件；试战使用所选层级。')}</p>
    ${slotActions && SlotComponent ? html`<p class="st-note">${t('先保存表单，再修改图标。')}</p><${SlotComponent} template="art" target=${{ kind: 'bond', key: bid }}
      slot=${{ at: ['bonds', bid], kind: 'image', field: 'icon' }} overlay=${state.overlay} issues=${state.check.issues} busy=${busy} ...${slotActions} />` : null}
    <${DraftValidation} draft=${draft} />
  </div>`;
}
export default { ...art, id: 'bond', Component: BondEditor };
