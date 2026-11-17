// public/studio/js/info.js — a plugin's other tabs in the studio (DESIGN §32.9): 信息 (the basic fields — name, description,
// version, authors, licence, credits for where the art comes from, homepage, who may switch it on: POST …/meta), 文件
// (every file of the folder, the ones nothing uses marked, each removable), 清单 (plugin.json itself, for those who
// prefer to write it — PUT …/manifest; the same checks answer).

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button } from '../../js/ui/components.js';
import { getLang, t } from '../../../shared/i18n.js';
import { IssueList, issuesAt } from './issues.js';
import { sizeText } from './labels.js';
import { VERSIONS, DEFAULT_VERSION } from '../../../shared/versions.js';
import { LICENSES } from './create.js';

const cx = (...p) => p.filter(Boolean).join(' ');
const textIn = (v, lang) => (v && typeof v === 'object' ? v[lang] ?? v.zh ?? Object.values(v)[0] ?? '' : typeof v === 'string' ? v : '');

/**
 * The basic fields (see the header).
 * @param {{ state: any, busy: boolean, onSave: (fields: Record<string, unknown>, lang: string) => void, onFix: (issue: any) => void }} props
 */
export function InfoForm({ state, busy, onSave, onFix }) {
  const m = state.manifest || {};
  const lang = /^zh/.test(getLang()) ? 'zh' : 'en';
  const init = () => ({
    name: textIn(m.name, lang), description: textIn(m.description, lang), version: String(m.version ?? ''),
    authors: Array.isArray(m.authors) ? m.authors.join(', ') : String(m.authors ?? ''), license: String(m.license ?? ''),
    versions: Array.isArray(m.versions) ? m.versions : [DEFAULT_VERSION],
    credits: String(m.credits ?? ''), homepage: String(m.homepage ?? ''),
    room: Array.isArray(m.scope) ? m.scope.includes('room') : true, personal: Array.isArray(m.scope) ? m.scope.includes('personal') : true,
  });
  const [f, setF] = useState(init);
  const [was, setWas] = useState(init);
  useEffect(() => { const v = init(); setF(v); setWas(v); }, [state.text]);
  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget.type === 'checkbox' ? e.currentTarget.checked : e.currentTarget.value });
  const fieldsOf = (v) => ({
    name: v.name, description: v.description, version: v.version, authors: v.authors, license: v.license, credits: v.credits, homepage: v.homepage,
    ...(['content', 'script', 'trusted'].includes(m.class) ? { versions: v.versions } : {}),
    scope: [...(v.room ? ['room'] : []), ...(v.personal ? ['personal'] : [])],
  });
  // only the fields the author changed: a name shown from another language is not written into this one, and a version
  // that is not right yet does not hold back the other fields
  const save = () => {
    const now = fieldsOf(f);
    const before = fieldsOf(was);
    onSave(Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k]))), lang);
  };
  const at = (k) => issuesAt(state.check.issues, { at: [k] });
  const row = (k, label, input, hint = '') => html`<div class="st-field-row">
    <span>${label}</span>${input}${hint ? html`<small>${hint}</small>` : null}
    <${IssueList} issues=${at(k)} onFix=${onFix} busy=${busy} compact=${true} />
  </div>`;
  return html`<div class="st-form" data-testid="info-form">
    ${row('name', t('名字'), html`<input class="st-input" value=${f.name} maxLength="60" onInput=${set('name')} />`)}
    ${row('description', t('简介'), html`<textarea class="st-input" rows="3" maxLength="500" onInput=${set('description')}>${f.description}</textarea>`)}
    ${row('version', t('版本'), html`<input class="st-input" value=${f.version} maxLength="40" onInput=${set('version')} />`, t('三段数字，每次发布前调大，例如 1.0.1'))}
    ${['content', 'script', 'trusted'].includes(m.class) ? row('versions', t('游戏版本'), html`<span class="st-inline">${VERSIONS.map(v => html`<label class="st-check"><input type="checkbox" checked=${f.versions.includes(v.id)} onChange=${e => setF({ ...f, versions: e.currentTarget.checked ? [...f.versions, v.id] : f.versions.filter(id => id !== v.id) })} /> ${t(v.label)}</label>`)}</span>`) : null}
    ${row('authors', t('作者'), html`<input class="st-input" value=${f.authors} maxLength="300" onInput=${set('authors')} />`, t('多个作者用逗号分开'))}
    ${row('license', t('许可证'), html`<span class="st-inline">
      <input class="st-input" list="st-licenses" value=${f.license} maxLength="100" onInput=${set('license')} />
      <datalist id="st-licenses">${LICENSES.filter(Boolean).map((l) => html`<option value=${l} />`)}</datalist></span>`, t('别人能怎样使用你的素材，例如 CC-BY-4.0（署名即可转载）'))}
    ${row('credits', t('素材来源'), html`<textarea class="st-input" rows="2" maxLength="500" onInput=${set('credits')}>${f.credits}</textarea>`, t('谁画的、从哪里来；用了别人的作品请写明出处'))}
    ${row('homepage', t('主页'), html`<input class="st-input" value=${f.homepage} maxLength="300" onInput=${set('homepage')} placeholder="https://" />`)}
    ${row('scope', t('谁能开启'), html`<span class="st-inline">
      <label class="st-check"><input type="checkbox" checked=${f.room} onChange=${set('room')} /> ${t('房主给整个房间开')}</label>
      <label class="st-check"><input type="checkbox" checked=${f.personal} onChange=${set('personal')} /> ${t('玩家在设置里只给自己开')}</label></span>`)}
    <div class="st-form__actions"><${Button} variant="primary" onClick=${save} loading=${busy} disabled=${!f.room && !f.personal} data-testid="info-save">${t('保存信息')}<//></div>
  </div>`;
}

/**
 * The folder's files (see the header).
 * @param {{ state: any, busy: boolean, onRemove: (rel: string) => void, onFix: (issue: any) => void }} props
 */
export function FileList({ state, busy, onRemove, onFix }) {
  return html`<div class="st-files" data-testid="file-list">
    <table class="st-table">
      <thead><tr><th>${t('文件')}</th><th>${t('大小')}</th><th>${t('用途')}</th><th></th></tr></thead>
      <tbody>${state.files.map((f) => html`<tr key=${f.rel} class=${cx(!f.used && 'is-unused')}>
        <td><code>${f.rel}</code><${IssueList} issues=${issuesAt(state.check.issues, { file: f.rel })} onFix=${onFix} busy=${busy} compact=${true} /></td>
        <td class="num">${sizeText(f.bytes)}</td>
        <td>${f.rel === 'plugin.json' ? t('清单') : f.rel === 'plugin.lock.json' ? t('锁文件（打包生成）') : f.kind === 'doc' ? t('说明文档') : f.used ? t('在用') : t('没用到')}</td>
        <td>${f.rel !== 'plugin.json' ? html`<button type="button" class="st-link-btn is-danger" disabled=${busy} onClick=${() => onRemove(f.rel)}>${t('删除')}</button>` : null}</td>
      </tr>`)}</tbody>
    </table>
    <p class="st-note">${t('一共 {n} 个文件，{size}。插件文件夹里只放插件用到的文件；不要放官方游戏的文件。', { n: state.files.length, size: sizeText(state.bytes) })}</p>
  </div>`;
}

/**
 * plugin.json itself (see the header).
 * @param {{ state: any, busy: boolean, onSave: (text: string) => void }} props
 */
export function ManifestEditor({ state, busy, onSave }) {
  const [text, setText] = useState(state.text || '');
  const [bad, setBad] = useState('');
  useEffect(() => { setText(state.text || ''); setBad(''); }, [state.text]);
  const save = () => {
    try { JSON.parse(text); } catch (e) { setBad(String(e?.message || e)); return; }
    setBad('');
    onSave(text);
  };
  return html`<div class="st-manifest" data-testid="manifest-editor">
    <p class="st-note">${t('高级：直接编辑 plugin.json。字段说明见 docs/PLUGINS.md §3 和 §9；编辑器支持 schemas/plugin.schema.json 自动补全。')}</p>
    <textarea class="st-input st-code" spellcheck="false" rows="22" value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    ${bad ? html`<pre class="st-error">${t('不是有效的 JSON：{why}', { why: bad })}</pre>` : null}
    <div class="st-form__actions"><${Button} variant="primary" onClick=${save} loading=${busy} disabled=${text === state.text}>${t('保存清单')}<//></div>
  </div>`;
}
