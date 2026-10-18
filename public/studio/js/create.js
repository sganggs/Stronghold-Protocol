// public/studio/js/create.js — 新建插件 (DESIGN §32.9): pick a template (换头像 / 立绘, 换 Spine 模型, 换语音, 换音乐 / 音效),
// pick what it changes by its official name, give it a name — the id is made from it (GET /studio/api/suggest-id: a
// legal id nobody has; editable), an author and a licence if wanted — and the server makes the folder from the template
// (POST /studio/api/plugins: plugin.json and a README, no file of the game).

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from '../../js/ui/components.js';
import { getLang, t } from '../../../shared/i18n.js';
import { get, post } from './api.js';
import { templateTitle, templateLine, targetName, kindLabel } from './labels.js';
import { TargetPicker } from './picker.js';
import { errorText } from './issues.js';
import { pluginIdIssue } from './pluginId.js';

const cx = (...p) => p.filter(Boolean).join(' ');

/**
 * The line under the id field. A non-empty illegal id names the fault (GitHub #701), in the catalogue's words
 * where it has them (2 到 32 位小写字母、数字和连字符; 不能以 - 开头). Empty or legal keeps the generic hint.
 * @param {import('./pluginId.js').PluginIdIssue | null} issue
 * @returns {string}
 */
function idFieldHint(issue) {
  if (issue === 'short') return t('太短：id 是 2 到 32 位小写字母、数字和连字符');
  if (issue === 'upper') return t('有大写字母：只能用小写字母、数字和连字符');
  if (issue === 'lead') return t('不能以 - 开头');
  if (issue === 'char') return t('有不能用的字符：只能用小写字母、数字和连字符');
  if (issue === 'long') return t('太长：id 是 2 到 32 位小写字母、数字和连字符');
  return t('自动生成；2–32 个小写英文字母、数字或 -');
}

/** Licences offered for a new plugin (SPDX ids; the author may type another, or none). */
export const LICENSES = Object.freeze(['', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC0-1.0', 'MIT']);

/**
 * The dialog (see the header).
 * @param {{ open: boolean, templates: { id: string, kinds: string[] }[], onClose: () => void, onCreated: (state: any) => void }} props
 */
export function CreateDialog({ open, templates, onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [tpl, setTpl] = useState(null);
  const [target, setTarget] = useState(null);
  const [name, setName] = useState('');
  const [nameAuto, setNameAuto] = useState(true);
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [author, setAuthor] = useState('');
  const [license, setLicense] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setStep(0); setTpl(null); setTarget(null); setName(''); setNameAuto(true); setId(''); setIdTouched(false); setAuthor(''); setLicense(''); setError('');
  }, [open]);
  // the default name: what it changes and how — it follows another target or template until the author types one
  useEffect(() => {
    if (!tpl || step !== 2 || (name && !nameAuto)) return;
    setName(target ? `${targetName(target)} · ${templateTitle(tpl.id)}` : templateTitle(tpl.id));
    setNameAuto(true);
  }, [step, target, tpl]);
  // the id follows the name until the author edits it
  useEffect(() => {
    if (!open || step !== 2 || idTouched) return undefined;
    const timer = setTimeout(() => {
      get(`suggest-id?name=${encodeURIComponent(name)}&template=${encodeURIComponent(tpl?.id || '')}${target ? `&target=${encodeURIComponent(`${target.kind}:${target.key}`)}` : ''}`)
        .then((r) => { if (r?.id) setId(r.id); }).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [name, step, idTouched, target, tpl]);
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const st = await post('plugins', { template: tpl.id, id, name, target: target ? `${target.kind}:${target.key}` : undefined, authors: author ? [author] : [], license, lang: /^zh/.test(getLang()) ? 'zh' : 'en' });
      onCreated(st);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const idIssue = pluginIdIssue(id);
  const idOk = idIssue == null && id.length > 0;
  const actions = html`
    ${step > 0 ? html`<${Button} onClick=${() => setStep(step === 2 && !tpl?.kinds.length ? 0 : step - 1)} disabled=${busy}>${t('上一步')}<//>` : null}
    <${Button} onClick=${onClose} disabled=${busy}>${t('取消')}<//>
    ${step === 1 ? html`<${Button} onClick=${() => setStep(2)} disabled=${busy}>${target ? t('下一步') : t('先跳过')}<//>` : null}
    ${step === 2 ? html`<${Button} variant="primary" onClick=${create} loading=${busy} disabled=${!idOk || !name.trim()} data-testid="create-confirm">${t('创建插件')}<//>` : null}`;
  return html`<${Modal} open=${open} title=${t('新建插件')} micro=${t('第 {n} / 3 步', { n: step + 1 })} onClose=${busy ? undefined : onClose} width="9.4rem" actions=${actions}>
    ${step === 0 ? html`<div class="st-templates" data-testid="templates">
      ${templates.map((x) => html`<button type="button" key=${x.id} class=${cx('st-template', tpl?.id === x.id && 'is-on')} data-template=${x.id}
          onClick=${() => { setTpl(x); setTarget(null); setStep(x.kinds.length ? 1 : 2); }}>
        <strong>${templateTitle(x.id)}</strong>
        <span>${templateLine(x.id)}</span>
        <small>${x.kinds.map(kindLabel).join(' · ')}</small>
      </button>`)}
    </div>` : null}
    ${step === 1 && tpl ? html`<div class="st-step">
      <p class="st-note">${t('「{template}」选择参考目标，按官方名字搜索：', { template: templateTitle(tpl.id) })}</p>
      <${TargetPicker} kinds=${tpl.kinds} selected=${target} autoFocus=${true} onPick=${(tg) => { setTarget(tg); setStep(2); }} />
    </div>` : null}
    ${step === 2 && tpl ? html`<div class="st-form">
      ${target ? html`<p class="st-note">${t('替换：{name}（{kind}）', { name: targetName(target), kind: kindLabel(target.kind) })}</p>` : null}
      <label class="st-field-row"><span>${t('插件名字')}</span>
        <input class="st-input" value=${name} maxLength="60" onInput=${(e) => { setName(e.currentTarget.value); setNameAuto(false); }} data-testid="create-name" /></label>
      <label class="st-field-row"><span>${t('插件 id（文件夹名）')}</span>
        <input class=${cx('st-input', idIssue && 'is-bad')} value=${id} onInput=${(e) => { setIdTouched(true); setId(e.currentTarget.value); }} data-testid="create-id" />
        <small data-testid="create-id-hint">${idFieldHint(idIssue)}</small></label>
      <label class="st-field-row"><span>${t('作者（可选）')}</span>
        <input class="st-input" value=${author} maxLength="200" onInput=${(e) => setAuthor(e.currentTarget.value)} /></label>
      <label class="st-field-row"><span>${t('许可证（可选）')}</span>
        <select class="st-input" value=${license} onChange=${(e) => setLicense(e.currentTarget.value)}>
          ${LICENSES.map((l) => html`<option value=${l}>${l || t('暂不选')}</option>`)}
        </select>
        <small>${t('别人能不能转发、修改你的素材；以后在「信息」里也能改')}</small></label>
      ${error ? html`<pre class="st-error">${error}</pre>` : null}
    </div>` : null}
  <//>`;
}
