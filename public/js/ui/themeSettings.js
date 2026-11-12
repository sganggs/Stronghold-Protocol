// Settings → 界面主题. The same dialog on the title, in the lobby and in a match (ui/settings.js).
// Import stays on this device. Switching calls selectTheme, which paints immediately.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, confirmDialog } from './components.js';
import { t } from '../../../shared/i18n.js';
import { THEME_LIMITS } from '../../../shared/uiTheme.js';
import {
  BUILTIN_ID, bootUiThemes, deleteTheme, importThemeFiles, importThemeZip, prepareTheme, selectTheme, themeCards, themeStatus,
} from '../uiTheme.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

function packFailText(code) {
  switch (code) {
    case 'too-big': return t('主题包太大');
    case 'too-many-files': return t('文件过多');
    case 'too-many-packs': return t('主题太多（最多 {n} 个）', { n: THEME_LIMITS.packs });
    case 'bad-path': return t('路径不允许');
    case 'name':
    case 'bad-id':
    case 'reserved-id': return t('主题信息不完整');
    default: return t('不是界面主题包');
  }
}

function fileFailText(code) {
  switch (code) {
    case 'bad-path': return t('路径不允许');
    case 'bad-type': return t('不是允许的图片或音频');
    case 'image-too-big':
    case 'file-too-big': return t('图片过大');
    case 'image-dim': return t('图片尺寸过大');
    case 'not-image': return t('不是图片');
    case 'audio-too-big': return t('音频过大');
    case 'missing': return t('缺少文件');
    case 'bad-slice': return t('切图参数无效');
    case 'bad-color': return t('颜色无效');
    case 'bad-token': return t('界面变量无效');
    case 'bad-voice': return t('语音文件无效');
    default: return t('无法使用这个文件');
  }
}

function flat(report, key) {
  const bag = report?.[key];
  if (!bag) return [];
  if (Array.isArray(bag)) return bag;
  const out = [];
  for (const value of Object.values(bag)) {
    if (Array.isArray(value)) out.push(...value);
  }
  return out;
}

function line(items) {
  return items.length ? items.join('、') : t('无');
}

/**
 * @param {{ activeId?: string }} props `activeId` empty means the built-in terminal.
 */
export function ThemeSection({ activeId = '' }) {
  const zipRef = useRef(null);
  const dirRef = useRef(null);
  const [cards, setCards] = useState(() => themeCards());
  const [report, setReport] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => setCards(themeCards());

  useEffect(() => {
    let live = true;
    bootUiThemes().then(() => {
      if (!live) return;
      refresh();
      const status = themeStatus();
      if (status.notice === 'broken') setNotice('broken');
      else if (status.notice === 'session') setNotice('session');
    }, () => { if (live) setNotice('session'); });
    return () => { live = false; };
  }, []);

  const show = (result) => {
    refresh();
    if (!result) return;
    if (!result.ok) {
      setReport({ fail: packFailText(result.code) });
      return;
    }
    setReport(result.report);
    if (result.notice === 'session') setNotice('session');
  };

  const onZip = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { show(await importThemeZip(file)); } finally { setBusy(false); }
  };
  const onDir = async (e) => {
    const list = e.target.files;
    e.target.value = '';
    if (!list || !list.length) return;
    setBusy(true);
    try { show(await importThemeFiles(list)); } finally { setBusy(false); }
  };
  const useTheme = async (id) => {
    setBusy(true);
    try {
      const prepared = await prepareTheme(id);
      if (!prepared.ok) {
        if (prepared.code !== 'missing') setNotice('broken');
        refresh();
        return;
      }
      selectTheme(id);
      refresh();
    } finally { setBusy(false); }
  };
  const remove = async (card) => {
    const ok = await confirmDialog({
      title: t('删除'),
      text: t('删除主题「{name}」？只从这台设备移除。', { name: card.name }),
      okText: t('删除'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try { await deleteTheme(card.id); refresh(); } finally { setBusy(false); }
  };

  const usingBuiltin = !activeId;
  return html`<section class="theme-page" aria-labelledby="theme-page-title" data-testid="ui-theme-page">
    <div class="set-keys__head sw-sec__head">
      <span class="sw-sec__glyph" aria-hidden="true"><${Icon} name="edit" /></span>
      <span class="set-row__label sw-sec__name" id="theme-page-title"><i>[</i> ${t('界面主题')} <i>]</i><${MicroLabel}>UI THEME<//></span>
      <span class="theme-page__actions">
        <${Button} variant="ghost" size="sm" disabled=${busy} onClick=${() => zipRef.current?.click()}>${t('导入主题包')}<//>
        <${Button} variant="ghost" size="sm" disabled=${busy} onClick=${() => dirRef.current?.click()}>${t('导入文件夹')}<//>
      </span>
    </div>
    <input ref=${zipRef} type="file" accept=".zip,application/zip" class="theme-file" data-testid="theme-import-zip" onChange=${onZip} />
    <input ref=${dirRef} type="file" class="theme-file" data-testid="theme-import-dir" webkitdirectory=${true} multiple=${true} onChange=${onDir} />
    <p class="set-hint">${t('主题包只保存在这台设备的浏览器里，不会上传，其他玩家看不到，也不改变对局。')}</p>
    ${notice === 'session' ? html`<p class="set-keys__note is-warn" role="status">${t('浏览器存储不可用，主题只在本次打开期间保留。')}</p>` : null}
    ${notice === 'broken' ? html`<p class="set-keys__note is-warn" role="status">${t('这个主题已损坏，已回到卫戍协议终端。')}</p>` : null}
    <div class="theme-grid">
      <article class=${cx('theme-card', usingBuiltin && 'is-on')} data-theme-id=${BUILTIN_ID}>
        <span class="theme-card__thumb" aria-hidden="true">${[...t('卫戍协议终端')][0]}</span>
        <div class="theme-card__meta">
          <b class="theme-card__name">${t('卫戍协议终端')}</b>
          <span class="theme-card__by">${t('内置')}</span>
        </div>
        <div class="theme-card__actions">
          ${usingBuiltin
            ? html`<span class="theme-card__using">${t('使用中')}</span>`
            : html`<${Button} variant="secondary" size="sm" onClick=${() => useTheme('')}>${t('使用')}<//>`}
        </div>
      </article>
      ${cards.map((card) => {
        const on = activeId === card.id;
        const title = card.official ? t(card.name) : card.name;
        return html`<article key=${card.official ? `official:${card.id}` : card.id} class=${cx('theme-card', on && 'is-on', card.official && 'is-official')} data-theme-id=${card.id} data-official=${card.official ? '1' : '0'}>
          ${card.thumbnailUrl
            ? html`<img class="theme-card__thumb" src=${card.thumbnailUrl} alt="" />`
            : html`<span class="theme-card__thumb" aria-hidden="true">${(title || '?').slice(0, 1)}</span>`}
          <div class="theme-card__meta">
            <b class="theme-card__name">${title}</b>
            ${card.official
              ? html`<span class="theme-card__by theme-card__by--official"><span class="theme-card__mark">${t('官方')}</span>${t(card.description)}</span>`
              : html`<span class="theme-card__by">${t('作者 {author} · {version}', { author: card.author || t('无'), version: card.version || t('无') })}</span>`}
          </div>
          <div class="theme-card__actions">
            ${on
              ? html`<span class="theme-card__using">${t('使用中')}</span>`
              : html`<${Button} variant="secondary" size="sm" disabled=${busy} onClick=${() => useTheme(card.id)}>${t('使用')}<//>`}
            ${card.official ? null : html`<${Button} variant="ghost" size="sm" disabled=${busy} onClick=${() => remove(card)}>${t('删除')}<//>`}
          </div>
        </article>`;
      })}
    </div>
    ${report ? html`<div class="theme-report" data-testid="theme-report" role="status">
      ${report.fail ? html`<p>${report.fail}</p>` : html`
        <p>${t('导入完成')}</p>
        <p>${t('已使用：{used}', { used: line(flat(report, 'used')) })}</p>
        <p>${t('未使用：{unused}', { unused: line(flat(report, 'unused')) })}</p>
        <p>${t('已拒绝：{refused}', { refused: line((report.refused || []).map((item) => `${item.path}（${fileFailText(item.code)}）`)) })}</p>
        <p>${t('已忽略：{ignored}', { ignored: line(report.ignored || []) })}</p>`}
    </div>` : null}
  </section>`;
}
