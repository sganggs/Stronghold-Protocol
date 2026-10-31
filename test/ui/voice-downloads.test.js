import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeVoiceDownloads, downloadVoiceLanguages, setDownloadVoice, setDownloadVoiceLanguage } from '../../public/js/voiceDownloads.js';

const a = 'char_102_texas', b = 'char_103_angel', c = 'char_010_chen';
const slots = { select: '/assets/voice.mp3' };
const audio = { voice: { [a]: slots, [b]: slots, [c]: slots }, voiceJp: { [a]: slots, [b]: slots, [c]: slots },
	voiceEn: { [a]: slots }, voiceNative: { [a]: slots } };
const choices = (selection, id, manifest = audio) => downloadVoiceLanguages(selection, id, manifest);

test('malformed preferences are sanitized and old empty/unavailable selections get one available dub', () => {
	assert.deepEqual(sanitizeVoiceDownloads(null), { languages: ['cn'], operators: {} });
	const result = sanitizeVoiceDownloads({ languages: ['en', 'jp', 'en', 'invalid'],
		operators: { [a]: ['jp', 'en'], [b]: [], invalid: ['cn'], [c]: 'cn' } });
	assert.deepEqual(result, { languages: ['jp', 'en'], operators: { [a]: ['jp', 'en'], [b]: [] } });
	assert.deepEqual(choices(result, b), ['cn']);
	assert.deepEqual(choices(result, c), ['jp']);
	assert.deepEqual(choices({ languages: [], operators: {} }, a), ['cn']);
	assert.deepEqual(choices({ languages: ['kr'], operators: {} }, a, { voiceJp: audio.voiceJp }), ['jp']);
	assert.deepEqual(choices(result, 'char_000_unvoiced'), []);
	assert.deepEqual(sanitizeVoiceDownloads(JSON.parse(JSON.stringify(result))), result);
});

test('Chinese + native then clearing Chinese retains Chinese only for operators without native', () => {
	let selection = setDownloadVoiceLanguage(sanitizeVoiceDownloads(null), audio, 'native', true);
	const before = JSON.stringify(selection);
	selection = setDownloadVoiceLanguage(selection, audio, 'cn', false);
	assert.deepEqual(choices(selection, a), ['native']);
	assert.deepEqual(choices(selection, b), ['cn']);
	assert.deepEqual(choices(selection, c), ['cn']);
	assert.notEqual(JSON.stringify(selection), before);
	assert.equal(Object.values(audio.voice).filter((_, i) => choices(selection, [a, b, c][i]).includes('cn')).length, 2);
});

test('Chinese + Japanese + native then clearing Chinese and Japanese retains partial Japanese and all native', () => {
	let selection = sanitizeVoiceDownloads(null);
	selection = setDownloadVoiceLanguage(selection, audio, 'jp', true);
	selection = setDownloadVoiceLanguage(selection, audio, 'native', true);
	selection = setDownloadVoiceLanguage(selection, audio, 'cn', false);
	assert.deepEqual(choices(selection, a), ['jp', 'native']);
	assert.deepEqual(choices(selection, b), ['jp']);
	selection = setDownloadVoiceLanguage(selection, audio, 'jp', false);
	assert.deepEqual(choices(selection, a), ['native']);
	assert.deepEqual(choices(selection, b), ['jp']);
	assert.deepEqual(choices(selection, c), ['jp']);
	// Repeating a bulk clear or clearing the last row choice must not remove the retained dub.
	const repeated = setDownloadVoiceLanguage(selection, audio, 'jp', false);
	assert.deepEqual(choices(repeated, b), ['jp']);
	assert.deepEqual(choices(setDownloadVoice(selection, a, 'native', false, audio), a), ['native']);
});

test('unavailable requested languages cannot satisfy the last-language guard; bulk changes preserve individual exceptions', () => {
	const limited = { ...audio, voiceJp: { [a]: slots } };
	const initial = { languages: ['cn', 'jp'], operators: { [a]: ['cn', 'en'] } };
	const before = JSON.stringify(initial);
	const selection = setDownloadVoiceLanguage(initial, limited, 'cn', false);
	assert.equal(JSON.stringify(initial), before);
	assert.deepEqual(choices(selection, a, limited), ['en']);
	assert.deepEqual(choices(selection, b, limited), ['cn']);
	assert.deepEqual(choices(selection, c, limited), ['cn']);
	const restored = setDownloadVoiceLanguage(selection, limited, 'cn', true);
	assert.deepEqual(choices(restored, a, limited), ['cn', 'en']);
});
