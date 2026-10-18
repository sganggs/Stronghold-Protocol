import { useState } from '../../../vendor/hooks.module.js';
import { html, Button, Modal } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { availableSkins } from '../../../js/ui/skins.js';
import { SkinPreview } from '../../../js/ui/skinPicker.js';
import { presentationOptions, skinTarget } from '../presentation.js';
import { PLUGIN_SUFFIX } from '../preview/layers.js';
import { slotLabel } from '../labels.js';
import { fileBase64 } from '../api.js';
import { Line, Upload, SaveMediaNote, PresentationIssues } from './presentationControls.js';
import art from './art.js';
import spine from './spine.js';

export function SkinsEditor({ draft, onChange, onFiles, onClear, dirty, busy }) {
  const o = presentationOptions('skins', draft.options);
  const charId = skinTarget(draft.target);
  const [preview, setPreview] = useState(null);
  const rows = availableSkins(`${charId}${PLUGIN_SUFFIX}`);
  const change = outfits => onChange({ ...draft, options: { ...o, outfits } });
  const edit = (i, patch) => change(o.outfits.map((outfit, j) => i === j ? { ...outfit, ...patch } : outfit));
  return html`<div class="st-form" data-testid="skins-editor">
    <code>${charId}</code>
    <p class="st-note">${t('每名干员最多 64 套；皮肤键允许字母、数字及 _ @ # + . -，最长 64 字符。没有正面模型的时装不能在游戏里穿戴。')}</p>
    <${SaveMediaNote} dirty=${dirty} />
    ${o.outfits.map((outfit, i) => {
      const row = rows.find(row => row.id === outfit.key);
      const upload = (slot, files) => Promise.all(files.map(async file => ({ name: file.name, data: await fileBase64(file) }))).then(files => onFiles(slot, files));
      return html`<fieldset class="st-presentation-row" key=${i}><legend>${outfit.name}</legend>
        <${Line} label=${t('皮肤键')} value=${outfit.key} onChange=${key => edit(i, { key })} />
        <${Line} label=${t('名称')} value=${outfit.name} maxLength=${10000} onChange=${name => edit(i, { name })} />
        <${Line} label=${t('系列')} value=${outfit.group} maxLength=${10000} onChange=${group => edit(i, { group })} />
        ${['avatar', 'portrait', 'front', 'back'].map(field => {
          const model = field === 'front' || field === 'back';
          const slot = { at: ['chars', charId, 'skins', outfit.key, ...(model ? ['spine', field] : [field])], field, kind: model ? 'spine' : 'image' };
          const value = model ? outfit.spine?.[field] : outfit[field];
          return html`<div key=${field}><${Upload} label=${slotLabel(slot)} accept=${(model ? spine : art).accept(slot)} multiple=${model} disabled=${busy || dirty} onFiles=${files => upload(slot, files)} />
            ${value ? html`<${Button} size="sm" disabled=${busy || dirty} onClick=${() => onClear(slot)}>${t('清除素材')}<//>` : null}
          <small>${(model ? spine : art).hint(slot)}</small></div>`;
        })}
        ${row ? html`<button type="button" class="st-skin-tile" data-testid="skin-tile-preview" onClick=${() => setPreview({ ...row, name: outfit.name, group: outfit.group })}>
          ${row.portrait || row.avatar ? html`<img src=${row.portrait || row.avatar} alt=${outfit.name} />` : null}
          <b>${outfit.name}</b><span>${outfit.group}</span><small>${row.playable ? t('可穿戴') : t('仅图片')}</small>
        </button>` : null}
        <${Button} size="sm" onClick=${() => change(o.outfits.filter((_, j) => j !== i))}>${t('删除')}<//>
      </fieldset>`;
    })}
    <${Button} disabled=${o.outfits.length >= 64} onClick=${() => {
      const key = Array.from({ length: 65 }, (_, i) => `outfit-${i + 1}`).find(key => !o.outfits.some(s => s.key === key));
      change([...o.outfits, { key, name: t('新时装'), group: '' }]);
    }}>${t('添加时装')}<//>
    <${PresentationIssues} draft=${draft} />
    <${Modal} open=${!!preview} title=${preview?.name || t('外观预览')} onClose=${() => setPreview(null)}>
      <${SkinPreview} art=${preview?.illust || preview?.portrait || preview?.avatar} name=${preview?.name} />
    <//>
  </div>`;
}
export default { id: 'skins', Component: SkinsEditor };
