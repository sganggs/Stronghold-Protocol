// Manifest-driven controls shared by the room panel and the studio's trial selector.
import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { ComboBox } from './comboBox.js';
import { getLang, t } from '../../../shared/i18n.js';
import { normalizeSettings } from '../../../shared/plugins/patch.js';
import { inputNumber, syncNumberInput } from './numberInput.js';

export function settingsSelection(ids, plugins, change = null) {
  return ids.map(id => {
    const settings = change?.id === id ? change.settings : plugins.find(p => p.id === id)?.settings;
    return { id, ...(settings && Object.keys(settings).length ? { settings } : {}) };
  });
}
export const settingValue = (def, input) => def.type === 'boolean' ? !!input : def.type === 'enum' ? def.options[Number(input)] : Number(input);
export function validSetting(def, value) {
  return typeof value === typeof normalizeSettings({ value: def }, { value }).value && Object.is(value, normalizeSettings({ value: def }, { value }).value);
}

/** A setting's number box, not a controlled value (numberInput.js): a partial entry such as "0." is left alone. */
function SettingNumber({ setting, def, value, disabled, invalid, onValue }) {
  const ref = useRef(null), latest = useRef(value);
  latest.current = value;
  useLayoutEffect(() => syncNumberInput(ref.current, value), [value]);
  return html`<input ref=${ref} type="number" data-setting=${setting} min=${def.min} max=${def.max} step=${def.step ?? (def.type === 'integer' ? 1 : 'any')} disabled=${disabled}
    aria-invalid=${invalid ? 'true' : 'false'} onInput=${e => onValue(inputNumber(e.currentTarget))} onBlur=${e => syncNumberInput(e.currentTarget, latest.current, true)} />`;
}

export function PluginSettings({ definitions = {}, values = {}, disabled = false, onSave }) {
  const initial = normalizeSettings(definitions, values);
  const signature = JSON.stringify(initial);
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState({});
  useEffect(() => { setDraft(initial); setInvalid({}); }, [signature]);
  const keys = Object.keys(definitions);
  if (!keys.length) return null;
  const lang = getLang();
  const change = (key, raw) => {
    const def = definitions[key];
    const value = settingValue(def, raw);
    setDraft({ ...draft, [key]: value });
    setInvalid({ ...invalid, [key]: raw === '' || !validSetting(def, value) });
  };
  // a number box: undefined while the entry is partial, null when empty — both keep the last value and block Apply
  const changeNumber = (key, n) => {
    if (typeof n === 'number') return change(key, n);
    setInvalid({ ...invalid, [key]: true });
  };
  return html`<form class="plugin-settings" data-testid="plugin-settings" onSubmit=${e => { e.preventDefault(); if (!disabled && !Object.values(invalid).some(Boolean)) onSave(normalizeSettings(definitions, draft)); }}>
    <strong>${t('插件设置')}</strong>
    ${keys.map(key => {
      const def = definitions[key];
      const label = typeof def.label === 'string' ? def.label : def.label?.[lang] || def.label?.zh || def.label?.en || key;
      return html`<label key=${key} class="st-field-row plugin-settings__row"><span>${label}</span>
        ${def.type === 'boolean' ? html`<input type="checkbox" data-setting=${key} checked=${draft[key] === true} disabled=${disabled} onChange=${e => change(key, e.currentTarget.checked)} />`
          : def.type === 'enum' ? html`<${ComboBox} setting=${key} label=${label} disabled=${disabled} value=${String(Math.max(0, def.options.indexOf(draft[key])))}
            options=${def.options.map((v, n) => ({ value: String(n), label: String(v) }))} onChange=${e => change(key, e.currentTarget.value)} />`
          : html`<${SettingNumber} setting=${key} def=${def} value=${draft[key]} disabled=${disabled} invalid=${invalid[key]} onValue=${n => changeNumber(key, n)} />`}
      </label>`;
    })}
    ${Object.values(invalid).some(Boolean) ? html`<p class="set-hint is-warn">${t('设置值须符合范围和步长。')}</p>` : null}
    ${!disabled ? html`<${Button} type="submit" size="sm" disabled=${Object.values(invalid).some(Boolean) || JSON.stringify(draft) === signature}>${t('应用设置')}<//>` : null}
  </form>`;
}
