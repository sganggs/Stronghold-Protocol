// Browser-local dub preferences. Every variant of an operator shares its charId; absent entries follow the global dub.
//
// Four whole dubs — 中文 cn (audio.voice), 日本語 jp (voiceJp), English en (voiceEn), 한국어 kr (voiceKr) — plus the
// official CUSTOM group of the voice types (中文-方言 CN_TOPOLECT, 意大利语 ITA, 德文 GER, 俄文 RUS, 法语 FRE,
// 西班牙语 SPA) and 联动 LINKAGE. A special voice exists per operator only (audio.voiceSpecial[charId][type]), so an
// override may name one while the global setting stays a whole dub.
export const VOICE_LANGS = Object.freeze(['cn', 'jp', 'en', 'kr']);
export const VOICE_SPECIAL_TYPES = Object.freeze(['cn_topolect', 'ita', 'ger', 'rus', 'fre', 'spa', 'linkage']);
export const VOICE_CHOICES = Object.freeze([...VOICE_LANGS, ...VOICE_SPECIAL_TYPES]);
export function sanitizeVoiceOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, lang] of Object.entries(raw).slice(0, 512)) {
    if (/^char_[0-9]+_[a-z0-9]+$/.test(id) && id.length <= 80 && VOICE_CHOICES.includes(lang)) out[id] = lang;
  }
  return out;
}
export function voiceLangFor(charId, globalLang, overrides) {
  const own = Object.hasOwn(overrides || {}, charId) ? overrides[charId] : null;
  if (VOICE_CHOICES.includes(own)) return own;
  return VOICE_LANGS.includes(globalLang) ? globalLang : 'cn';
}
