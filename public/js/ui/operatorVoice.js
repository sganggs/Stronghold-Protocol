// Local listening preference, shared by roster and DIY details; deliberately absent from room.loadout.
// Options are the dubs this server actually has for this operator (data/assets.json audio trees), plus 跟随全局.
// A saved choice whose tree is absent stays in the list, marked unavailable; playback falls back in voiceLangFor.
import { html } from './components.js';
import { useSettings, updateSettings } from './settings.js';
import { t, N_ } from '../../../shared/i18n.js';
import { data } from '../data.js';
import { audio } from '../audio.js';
import { VOICE_LANGS, VOICE_PICKS, VOICE_TREES } from '../voicePrefs.js';

const VOICE_LANG_NAMES = { cn: '中文', jp: '日本語', en: 'English', kr: '한국어' }; // i18n-ignore

/** Official voiceLangType of a CUSTOM dub → the name the dropdown shows. */
const NATIVE_NAMES = {
  ITA: N_('意大利语'),
  GER: N_('德文'),
  RUS: N_('俄文'),
  FRE: N_('法语'),
  SPA: N_('西班牙语'),
  CN_TOPOLECT: N_('中文-方言'),
};

function hasTree(audioManifest, charId, lang) {
  const key = lang === 'cn' ? 'voice' : VOICE_TREES[lang];
  const slots = audioManifest?.[key]?.[charId];
  return !!slots && typeof slots === 'object' && !Array.isArray(slots) && Object.keys(slots).length > 0;
}

function nativeLabel(audioManifest, charId) {
  const type = audioManifest?.voiceNativeLangType?.[charId];
  return NATIVE_NAMES[type] ? t(NATIVE_NAMES[type]) : t('本土语言');
}

/**
 * Dropdown rows for one operator. `saved` is the stored override (`''` / absent = follow the global dub).
 * @param {any} audioManifest manifest `audio` (null when assets have not loaded)
 * @param {string} charId
 * @param {string} [saved]
 * @returns {{ value: string, label: string, unavailable: boolean }[]}
 */
export function operatorVoiceOptions(audioManifest, charId, saved) {
  const options = [{ value: '', label: t('跟随全局'), unavailable: false }];
  for (const lang of VOICE_LANGS) {
    if (hasTree(audioManifest, charId, lang)) options.push({ value: lang, label: VOICE_LANG_NAMES[lang], unavailable: false });
  }
  if (hasTree(audioManifest, charId, 'native')) {
    options.push({ value: 'native', label: nativeLabel(audioManifest, charId), unavailable: false });
  }
  if (saved && VOICE_PICKS.includes(saved) && !options.some((o) => o.value === saved)) {
    const name = saved === 'native' ? t('本土语言') : (VOICE_LANG_NAMES[saved] || saved);
    options.push({ value: saved, label: `${name}${t('（此服务器没有）')}`, unavailable: true });
  }
  return options;
}

export function OperatorVoice({ charId }) {
  const settings = useSettings();
  if (!charId) return null;
  const value = settings.voiceOverrides[charId] || '';
  const options = operatorVoiceOptions(data.get('assets')?.audio, charId, value);
  const change = (lang) => {
    const voiceOverrides = { ...settings.voiceOverrides };
    if (lang) voiceOverrides[charId] = lang;
    else delete voiceOverrides[charId];
    updateSettings({ voiceOverrides });
  };
  const preview = () => {
    const chosen = options.find((o) => o.value === value);
    if (chosen && chosen.value && !chosen.unavailable) audio.previewVoice(charId, chosen.value);
    else audio.previewVoice(charId);
  };
  return html`<label class="lo-voice" data-voice-char=${charId}>
    <span>${t('此干员语音')}</span>
    <span class="lo-select"><select aria-label=${t('此干员语音')} value=${value} onChange=${(e) => change(e.currentTarget.value)}>
      ${options.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
    </select></span>
    <button type="button" class="lo-voice__preview" onClick=${preview}>${t('试听')}</button>
    <small>${t('仅保存在此浏览器。未把中文列入下载时，缺句不再请求中文。')}</small>
  </label>`;
}
