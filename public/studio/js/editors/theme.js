import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html, Button } from '../../../js/ui/components.js';
import { t } from '../../../../shared/i18n.js';
import { THEME_TOKENS, acceptThemeValue } from '../../../../shared/plugins/theme.js';
import { presentationOptions } from '../presentation.js';
import { NumberField, Select, without } from './controls.js';
import { Line, PresentationIssues } from './presentationControls.js';

/** Restore both values and priorities when leaving the editor, including unsaved drafts. */
export function previewTheme(style, vars) {
  const before = Object.keys(THEME_TOKENS).map(key => [key, style.getPropertyValue(key), style.getPropertyPriority(key)]);
  for (const [key, value] of Object.entries(vars)) if (acceptThemeValue(key, value)) style.setProperty(key, value);
  return () => { for (const [key, value, priority] of before) { if (value) style.setProperty(key, value, priority); else style.removeProperty(key); } };
}
// Native colour inputs are opaque RGB; the adjacent text control retains alpha / hsl spellings unchanged.
function colourHex(value) {
  if (typeof document === 'undefined') return '#000000';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '#000000';
  ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
  return '#' + [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('');
}
export function ThemeEditor({ draft, onChange }) {
  const o = presentationOptions('theme', draft.options);
  const defaults = useRef(null);
  const [live, setLive] = useState(true);
  if (!defaults.current && typeof document !== 'undefined') {
    const css = getComputedStyle(document.documentElement);
    defaults.current = Object.fromEntries(Object.keys(THEME_TOKENS).map(k => [k, css.getPropertyValue(k).trim()]));
  }
  useEffect(() => live ? previewTheme(document.documentElement.style, o.vars) : undefined, [live, JSON.stringify(o.vars)]);
  const set = (key, value) => onChange({ ...draft, options: { ...o, vars: value === undefined ? without(o.vars, key) : { ...o.vars, [key]: value } } });
  return html`<div class="st-form" data-testid="theme-editor">
    <label><input type="checkbox" checked=${live} onChange=${e => setLive(e.currentTarget.checked)} /> ${t('在工作台上实时预览主题')}</label>
    <p class="st-note">${t('只保存修改过的令牌；离开编辑器会恢复工作台外观。')}</p>
    ${Object.entries(THEME_TOKENS).map(([key, kind]) => {
      const value = o.vars[key] ?? defaults.current?.[key] ?? '';
      const colour = kind === 'colour' && acceptThemeValue(key, value) ? colourHex(value) : '#000000';
      const time = /^(\d*\.?\d+)(ms|s)$/.exec(value);
      return html`<div class="st-token" key=${key} data-token=${key}>
        <code>${key}</code><small>${t('默认：{value}', { value: defaults.current?.[key] || '' })}</small>
        ${kind === 'colour' ? html`<input type="color" aria-label=${key} value=${colour} onInput=${e => set(key, e.currentTarget.value)} />
          <${Line} label=${t('颜色值')} value=${value} maxLength=${400} onChange=${v => set(key, v)} />` : null}
        ${kind === 'time' ? html`<${NumberField} label=${t('时长（毫秒）')} min=${0} max=${2000} value=${time ? Number(time[1]) * (time[2] === 's' ? 1000 : 1) : null} onChange=${v => set(key, v === null ? '' : `${v}ms`)} />` : null}
        ${kind === 'easing' ? html`<${Select} label=${t('缓动')} value=${value.startsWith('cubic-bezier(') ? 'custom' : value}
          options=${['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', { id: 'custom', name: 'cubic-bezier' }]}
          onChange=${v => set(key, v === 'custom' ? 'cubic-bezier(0.2,0.8,0.2,1)' : v)} />
          ${value.startsWith('cubic-bezier(') ? [0,1,2,3].map(i => {
            const parts = value.slice(13, -1).split(',').map(Number);
            return html`<${NumberField} label=${['x1','y1','x2','y2'][i]} min=${i % 2 ? null : 0} max=${i % 2 ? null : 1} value=${parts[i]}
              onChange=${v => { parts[i] = v; set(key, `cubic-bezier(${parts.join(',')})`); }} />`;
          }) : null}` : null}
        <${Button} size="sm" disabled=${!Object.hasOwn(o.vars, key)} onClick=${() => set(key, undefined)}>${t('恢复默认')}<//>
      </div>`;
    })}
    <${PresentationIssues} draft=${draft} />
  </div>`;
}
export default { id: 'theme', Component: ThemeEditor };
