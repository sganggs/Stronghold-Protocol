import { useEffect, useState, useRef } from '../../../vendor/hooks.module.js';
import { html, Button } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { FX_PHASES } from '../../../js/render/vfx/pluginFormat.js';
import { fileBase64, get, API, pluginPath } from '../api.js';
import { TargetPicker } from '../picker.js';
import { presentationOptions, emptyBook } from '../presentation.js';
import { NumberField, Select, without } from './controls.js';
import { Line, Upload, PresentationIssues } from './presentationControls.js';

export function FxEditor({ draft, state, onChange, busy, onPendingRead = () => {} }) {
  const reads = useRef(new Map());
  const o = presentationOptions('fx', draft.options);
  const [details, setDetails] = useState({ units: [], slots: [] });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    get(`authoring?template=fx&target=${encodeURIComponent(`operator:${o.kitRef}`)}`).then(r => { if (alive) { setDetails(r); setFailed(false); } }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [o.kitRef]);
  const change = patch => onChange({ ...draft, options: { ...o, ...patch }, ...(draft.uploads ? { uploads: draft.uploads.filter(u => (patch.flipbooks || o.flipbooks).some(b => b.image === u.path)) } : {}) });
  const editBook = (i, patch) => change({ flipbooks: o.flipbooks.map((b, j) => j === i ? { ...b, ...patch } : b) });
  const editBinding = (i, patch) => change({ bindings: o.bindings.map((b, j) => j === i ? { ...b, ...patch } : b) });
  const unit = details.units.find(u => u.key === o.unit);
  const slots = details.slots.length ? details.slots : [{ id: '0', name: 'S1' }];
  const freeBinding = slots.flatMap(s => FX_PHASES.map(phase => ({ slot: s.id, phase }))).find(p => !o.bindings.some(b => b.slot === p.slot && b.phase === p.phase));
  return html`<div class="st-form" data-testid="fx-editor">
    <p class="st-note">${t('模板生成一个借用官方技能的演示干员；在「试一场」切换 2D / 3D 查看特效。')}</p>
    <details><summary>${t('技能来源')} · <code>${o.kitRef}</code></summary>
      <${TargetPicker} kinds=${['operator']} onPick=${target => change({ kitRef: target.key })} />
    </details>
    <${Select} label=${t('特效来源')} value=${o.source} options=${[{ id: 'official', name: t('借用官方特效') }, { id: 'flipbook', name: t('序列帧动画') }]} onChange=${source => change({ source })} />
    ${o.source === 'official' ? html`
      <p class="st-note">${details.units.length ? t('只列出本机特效索引已有的单位。官方特效仅在 3D 显示。') : t('本机特效索引缺失或没有可借用单位；请先提取官方特效，或选择序列帧动画。')}</p>
      ${failed ? html`<p class="st-error">${t('读取失败，请重试。')}</p>` : null}
      ${details.units.length ? html`<${TargetPicker} kinds=${['operator']} targets=${details.units} selected=${unit} onPick=${u => change({ unit: u.key, skills: {} })} />` : null}
      <code>${o.unit}</code>
      ${slots.map(slot => html`<${Select} key=${slot.id} label=${slot.name} value=${o.skills[slot.id] || ''}
        options=${[{ id: '', name: t('默认') }, ...(unit?.skills || []).map(id => ({ id, name: id }))]} onChange=${value => change({ skills: value ? { ...o.skills, [slot.id]: value } : without(o.skills, slot.id) })} />`)}
    ` : html`
      <p class="st-note">${t('PNG 必须为 8 位 RGB/RGBA，宽高不超过 2048，且能整除格子。')}</p>
      <p class="st-note">${t('选择图片后，与表单一起保存并校验。')}</p>
      ${o.flipbooks.map((b, i) => html`<fieldset class="st-presentation-row" key=${i}><legend>${b.id}</legend>
        <${Line} label=${t('特效 id')} value=${b.id} maxLength=${96} onChange=${id => editBook(i, { id })} />
        <${Upload} label=${t('PNG 序列帧')} accept=".png,image/png" disabled=${busy} onFiles=${async files => {
          const token = {}; reads.current.set(b.image, token); onPendingRead(1);
          try {
            const data = await fileBase64(files[0]);
            if (reads.current.get(b.image) !== token) return;
            onChange(latest => {
              if (latest.id !== draft.id || latest.revision !== draft.revision || !presentationOptions('fx', latest.options).flipbooks.some(book => book.image === b.image)) return latest;
              return { ...latest, uploads: [...(latest.uploads || []).filter(u => u.path !== b.image), { path: b.image, data }] };
            });
          } finally { if (reads.current.get(b.image) === token) reads.current.delete(b.image); onPendingRead(-1); }
        }} />
        ${draft.uploads?.some(u => u.path === b.image) ? html`<img class="st-sheet-preview" alt=${b.id} src=${`data:image/png;base64,${draft.uploads.find(u => u.path === b.image).data}`} />` : state.files?.some(f => f.rel === b.image) ? html`<img class="st-sheet-preview" alt=${b.id} src=${`${API}${pluginPath(state.id, `files/${b.image}`)}?v=${state.authoring.revision}`} />` : null}
        <${NumberField} label=${t('帧数')} min=${1} max=${256} step=${1} value=${b.frames} onChange=${frames => editBook(i, { frames })} />
        <${NumberField} label=${t('列数')} min=${1} max=${b.frames} step=${1} value=${b.cols} onChange=${cols => editBook(i, { cols })} />
        <${NumberField} label="fps" min=${0.1} max=${60} value=${b.fps} onChange=${fps => editBook(i, { fps })} />
        ${[0, 1].map(axis => html`<${NumberField} label=${axis ? t('锚点 Y') : t('锚点 X')} min=${0} max=${1} value=${b.anchor?.[axis] ?? 0.5}
          onChange=${v => { const anchor = [...(b.anchor || [0.5, 0.5])]; anchor[axis] = v; editBook(i, { anchor }); }} />`)}
        <${NumberField} label=${t('缩放')} min=${0.01} max=${8} value=${b.scale ?? 1} onChange=${scale => editBook(i, { scale })} />
        <${Select} label=${t('混合模式')} value=${b.blend || 'normal'} options=${['normal', 'add']} onChange=${blend => editBook(i, { blend })} />
        <label><input type="checkbox" checked=${!!b.loop} onChange=${e => editBook(i, { loop: e.currentTarget.checked })} /> ${t('循环')}</label>
        <${Button} size="sm" onClick=${() => change({ flipbooks: o.flipbooks.filter((_, j) => j !== i) })}>${t('删除')}<//>
      </fieldset>`)}
      <${Button} disabled=${o.flipbooks.length >= 128} onClick=${() => {
        const id = Array.from({ length: 129 }, (_, i) => `effect-${i + 1}`).find(id => !o.flipbooks.some(b => b.id === id));
        change({ flipbooks: [...o.flipbooks, emptyBook(id)] });
      }}>${t('添加序列帧')}<//>
      ${o.bindings.map((row, i) => html`<div class="st-presentation-row" key=${i}>
        <${Select} label=${t('技能槽位')} value=${row.slot} options=${slots} onChange=${slot => editBinding(i, { slot })} />
        <${Select} label=${t('特效相位')} value=${row.phase} options=${FX_PHASES} onChange=${phase => editBinding(i, { phase })} />
        <${Select} label=${t('特效 id')} value=${row.effect} options=${o.flipbooks.map(b => b.id)} onChange=${effect => editBinding(i, { effect })} />
        <${Button} size="sm" onClick=${() => change({ bindings: o.bindings.filter((_, j) => j !== i) })}>${t('删除')}<//>
      </div>`)}
      <${Button} disabled=${o.bindings.length >= 60 || !o.flipbooks.length || !freeBinding} onClick=${() => {
        if (freeBinding) change({ bindings: [...o.bindings, { ...freeBinding, effect: o.flipbooks[0].id }] });
      }}>${t('添加相位绑定')}<//>
    `}
    <${PresentationIssues} draft=${draft} />
  </div>`;
}
export default { id: 'fx', Component: FxEditor };
