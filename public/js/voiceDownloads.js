// Download choices are independent of playback preferences and interface locale.
import { createStore, loadPref, savePref } from './store.js';
import { VOICE_PICKS, VOICE_TREES } from './voicePrefs.js';

export const DOWNLOAD_VOICE_TREES = Object.freeze({ cn: 'voice', ...VOICE_TREES });
const cleanLanguages = (value) => VOICE_PICKS.filter((lang) => Array.isArray(value) && value.includes(lang));

export function sanitizeVoiceDownloads(raw) {
	const operators = {};
	for (const [id, langs] of Object.entries(raw?.operators || {}).slice(0, 512)) {
		if (/^char_[0-9]+_[a-z0-9]+$/.test(id) && Array.isArray(langs)) operators[id] = cleanLanguages(langs);
	}
	return { languages: Array.isArray(raw?.languages) ? cleanLanguages(raw.languages) : ['cn'], operators };
}

/** Effective choices always include one available dub for a voiced operator, repairing older empty/stale choices. */
export function downloadVoiceLanguages(selection, charId, audio) {
	const requested = Object.hasOwn(selection.operators, charId) ? selection.operators[charId] : selection.languages;
	const available = audio == null ? VOICE_PICKS : VOICE_PICKS.filter((lang) => {
		const slots = audio[DOWNLOAD_VOICE_TREES[lang]]?.[charId];
		return slots && typeof slots === 'object' && !Array.isArray(slots) && Object.keys(slots).length > 0;
	});
	const selected = available.filter((lang) => requested.includes(lang));
	if (selected.length || !available.length) return selected;
	return [available.includes('cn') ? 'cn' : available[0]];
}

export function setDownloadVoice(selection, charId, lang, checked, audio) {
	const current = downloadVoiceLanguages(selection, charId, audio);
	const langs = VOICE_PICKS.filter((id) => id === lang ? checked : current.includes(id));
	// Keep the operator's last selected available language, rather than substituting another language.
	const retained = langs.length ? langs : current;
	return { ...selection, operators: { ...selection.operators, [charId]: retained } };
}

/** Apply to the entire server roster, including operators hidden by the search field. */
export function setDownloadVoiceLanguage(selection, audio, lang, checked) {
	const languages = VOICE_PICKS.filter((id) => id === lang ? checked : selection.languages.includes(id));
	let result = selection;
	for (const charId of Object.keys(audio?.[DOWNLOAD_VOICE_TREES[lang]] || {})) {
		result = setDownloadVoice(result, charId, lang, checked, audio);
	}
	return { ...result, languages };
}

export const voiceDownloadStore = createStore(sanitizeVoiceDownloads(loadPref('voiceDownloads', null)));
voiceDownloadStore.subscribe((selection) => savePref('voiceDownloads', sanitizeVoiceDownloads(selection)));
