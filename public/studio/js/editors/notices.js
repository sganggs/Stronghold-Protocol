import { useState } from '../../../vendor/hooks.module.js';
import { html, Button } from '../../../js/ui/components.js';
import { getLang, t } from '../../../../shared/i18n.js';
import { localizeNotice, NOTICE_LIMITS } from '../../../../shared/plugins/notices.js';
import { presentationOptions } from '../presentation.js';
import { Select, without } from './controls.js';
import { Body, Line, PresentationIssues } from './presentationControls.js';

export function NoticesEditor({ draft, onChange }) {
  const o = presentationOptions('notices', draft.options);
  const [lang, setLang] = useState(getLang());
  const langs = ['zh', 'en', 'ja', 'ko', 'zh-TW'];
  const set = notices => onChange({ ...draft, options: { ...o, notices } });
  const edit = (i, patch) => set(o.notices.map((n, j) => j === i ? { ...n, ...patch } : n));
  return html`<div class="st-form" data-testid="notices-editor">
    <p class="st-note">${t('最多 20 条公告，标题 80 字，正文 2000 字；只显示纯文本。')}</p>
    <${Select} label=${t('预览语言')} value=${lang} options=${langs} onChange=${setLang} />
    ${o.notices.map((n, i) => {
      const preview = localizeNotice(n, lang);
      return html`<fieldset class="st-presentation-row" key=${i}><legend>${t('公告 {n}', { n: i + 1 })}</legend>
        <${Line} label="id" value=${n.id} maxLength=${32} onChange=${id => edit(i, { id })} />
        <${Line} label=${t('标题')} value=${n.title} maxLength=${10000} onChange=${title => edit(i, { title })} />
        <small>${[...n.title].length} / ${NOTICE_LIMITS.title}</small>
        <${Body} label=${t('正文')} value=${n.body} onChange=${body => edit(i, { body })} />
        <small>${[...n.body].length} / ${NOTICE_LIMITS.body}</small>
        <${Line} label=${t('日期')} type="date" value=${n.date} onChange=${date => edit(i, { date: date || undefined })} />
        ${langs.map(code => html`<div key=${code}>
          <label><input type="checkbox" checked=${!!n.i18n?.[code]} onChange=${e => edit(i, { i18n: e.currentTarget.checked ? { ...n.i18n, [code]: { title: n.title, body: n.body } } : without(n.i18n || {}, code) })} /> ${t('翻译：{lang}', { lang: code })}</label>
          ${n.i18n?.[code] ? html`<${Line} label=${t('标题')} value=${n.i18n[code].title} maxLength=${10000} onChange=${title => edit(i, { i18n: { ...n.i18n, [code]: { ...n.i18n[code], title } } })} />
            <${Body} label=${t('正文')} value=${n.i18n[code].body} onChange=${body => edit(i, { i18n: { ...n.i18n, [code]: { ...n.i18n[code], body } } })} />` : null}
        </div>`)}
        <article class="st-notice-preview" data-testid="notice-preview"><small>${n.date || ''}</small><h4>${preview.title}</h4><p>${preview.body}</p></article>
        <${Button} size="sm" onClick=${() => set(o.notices.filter((_, j) => j !== i))}>${t('删除')}<//>
      </fieldset>`;
    })}
    <${Button} disabled=${o.notices.length >= NOTICE_LIMITS.perPlugin} onClick=${() => {
      const id = Array.from({ length: 21 }, (_, i) => `notice-${i + 1}`).find(id => !o.notices.some(n => n.id === id));
      set([...o.notices, { id, title: '', body: '' }]);
    }}>${t('添加公告')}<//>
    <${PresentationIssues} draft=${draft} />
  </div>`;
}
export default { id: 'notices', Component: NoticesEditor };
