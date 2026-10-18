import { useEffect, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { get } from '../api.js';
import { gameplayOptions, editGameplay } from '../gameplayModel.js';
import { NumberField, TextField } from './controls.js';
import { Toggle, LongText, RecordPicker, DraftValidation } from './gameplayControls.js';

export function ItemEditor({ draft, onChange }) {
  const [details, setDetails] = useState(null);
  useEffect(() => { let live = true; get(`authoring?template=item&target=${encodeURIComponent(draft.target || '')}`).then(r => { if (live) setDetails(r); }); return () => { live = false; }; }, [draft.target]);
  return html`<${ItemForm} draft=${draft} onChange=${onChange} details=${details} />`;
}
export function ItemForm({ draft, onChange, details }) {
  const o = gameplayOptions(draft);
  const baseId = draft.options.base || details?.defaults.base || o.base;
  const change = patch => onChange(editGameplay(draft, { base: baseId, ...patch }));
  const base = details?.items[baseId];
  const canPair = !!(base?.goldenId && details?.items[base.goldenId]);
  const paired = o.paired && (details ? canPair : true);
  return html`<div class="st-form" data-testid="item-editor">
    <${TextField} label=${t('名字')} value=${o.name} onChange=${name => change({ name })} />
    <${RecordPicker} kind="item" table=${details?.items} label=${t('官方基础道具')} value=${baseId} onChange=${base => change({ base, paired: !!details?.items[base]?.goldenId, normal: {}, elite: {} })} />
    <${Toggle} label=${t('生成普通与精锐配对')} value=${paired} disabled=${!canPair} onChange=${paired => change({ paired })} />
    <${Toggle} label=${t('商店隐藏')} value=${o.hideInShop} onChange=${hideInShop => change({ hideInShop })} />
    <${Toggle} label=${t('排除商店')} value=${o.shopExcluded} onChange=${shopExcluded => change({ shopExcluded })} />
    <${NumberField} label=${t('商店排序')} value=${o.shopSortId} min=${-1e9} max=${1e9} onChange=${shopSortId => change({ shopSortId })} />
    ${(paired ? ['normal', 'elite'] : ['normal']).map(which => {
      const src = which === 'elite' ? details?.items[base?.goldenId] : base;
      const f = o[which], set = patch => change({ [which]: { ...f, ...patch } });
      return html`<fieldset><legend>${which === 'normal' ? t('普通') : t('精锐')}</legend>
        <${NumberField} label=${t('价格')} value=${f.price ?? src?.price} min=${0} max=${1e9} onChange=${price => set({ price })} />
        <${NumberField} label=${t('阶级')} value=${f.tier ?? src?.tier} min=${1} max=${6} step=${1} onChange=${tier => set({ tier })} />
        <${LongText} label=${t('描述')} value=${f.desc ?? src?.desc} onChange=${desc => set({ desc })} />
        ${(f.buffs || src?.buffs || []).map((b, i, buffs) => html`<fieldset><legend>${b.key} · ${b.bbStr?.key || ''}</legend>
          ${Object.entries(b.bb || {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => html`<${NumberField} label=${k} value=${v}
            min=${details?.bounds?.[k]?.min ?? -1e9} max=${details?.bounds?.[k]?.max ?? 1e9}
            onChange=${n => set({ buffs: buffs.map((x, j) => i === j ? { ...x, bb: { ...x.bb, [k]: n } } : x) })} />`)}
        </fieldset>`)}
      </fieldset>`;
    })}
    <${DraftValidation} draft=${draft} />
  </div>`;
}
export default { id: 'item', Component: ItemEditor };
