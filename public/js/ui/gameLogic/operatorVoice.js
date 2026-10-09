// Local listening preferences, keyed by the actual voiced charId (normal / elite / DIY share one preference).
const LANGS = ['cn', 'jp'];
const validId = (id) => typeof id === 'string' && /^char_[A-Za-z0-9_]{1,96}$/.test(id);

/** Bound persisted input and copy only own, valid preferences. Missing entries follow the global dub. */
export function sanitizeVoiceOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const id of Object.keys(raw)) {
    if (n >= 2048) break;
    if (validId(id) && LANGS.includes(raw[id])) { out[id] = raw[id]; n++; }
  }
  return out;
}

/** The explicit preference, or '' for follow global. */
export function voiceOverrideOf(overrides, charId) {
  return validId(charId) && Object.hasOwn(overrides || {}, charId) && LANGS.includes(overrides[charId]) ? overrides[charId] : '';
}

/** Immutable edit: selecting follow-global removes the entry instead of pinning today's global language. */
export function setVoiceOverride(overrides, charId, lang) {
  const out = sanitizeVoiceOverrides(overrides);
  if (!validId(charId)) return out;
  if (LANGS.includes(lang)) out[charId] = lang;
  else delete out[charId];
  return sanitizeVoiceOverrides(out);
}

export function voiceLanguageFor(overrides, charId, globalLang) {
  return voiceOverrideOf(overrides, charId) || (globalLang === 'jp' ? 'jp' : 'cn');
}

/** Availability in either manifest bank; JP may still fall back to Chinese per slot/file. */
export function hasOperatorVoice(audio, charId) {
  return ['voice', 'voiceJp'].some((bank) => Object.values(audio?.[bank]?.[charId] || {})
    .some((v) => (Array.isArray(v) ? v : [v]).some((url) => typeof url === 'string' && url.length > 0)));
}
