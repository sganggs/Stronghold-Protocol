import { html } from '../ui/components.js';
import { t } from '../../../shared/i18n.js';
import { hasOperatorVoice, voiceOverrideOf } from '../ui/gameLogic/operatorVoice.js';

const NAMES = { cn: '中文', jp: '日本語' }; // i18n-ignore

/** Shared, hook-free control for the roster, detail and DIY slot. Listening preferences are never match-locked. */
export function OperatorVoiceSelect({ m, charId, name, voiceOverrides = {}, voiceLang = 'cn', onVoice = null }) {
  const value = voiceOverrideOf(voiceOverrides, charId);
  const available = hasOperatorVoice(m?.audio, charId);
  return html`<label class=${`lo-select lo-voice${value ? ' is-off' : ''}`} title=${available ? t('语音语言') : t('此干员没有可用语音')}>
    <select data-voice-char=${charId} value=${value} disabled=${!available || !onVoice}
      aria-label=${t('选择{name}的语音语言', { name: name || charId || '' })}
      onChange=${(e) => onVoice?.(charId, e.currentTarget.value)}>
      <option value="">${t('跟随全局（{language}）', { language: NAMES[voiceLang === 'jp' ? 'jp' : 'cn'] })}</option>
      <option value="cn">${NAMES.cn}</option><option value="jp">${NAMES.jp}</option>
    </select>
  </label>`;
}
