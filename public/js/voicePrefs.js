// Browser-local dub preferences. Every variant of an operator shares its charId; absent entries follow the global dub.
export const VOICE_LANGS = Object.freeze(['cn', 'jp']);
export function sanitizeVoiceOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, lang] of Object.entries(raw).slice(0, 512)) {
    if (/^char_[0-9]+_[a-z0-9]+$/.test(id) && id.length <= 80 && VOICE_LANGS.includes(lang)) out[id] = lang;
  }
  return out;
}
export function voiceLangFor(charId, globalLang, overrides) {
  const own = Object.hasOwn(overrides || {}, charId) ? overrides[charId] : null;
  return VOICE_LANGS.includes(own) ? own : globalLang === 'jp' ? 'jp' : 'cn';
}
