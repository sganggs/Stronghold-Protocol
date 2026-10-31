// Public client API for local resource completeness. Asset probes never fall back to the network.
// The server must retain full manifests even when deployments require users to supply their own art.
import { collectAssetUrls } from './assetDownload.js';
import { readServedManifests } from './assetPack.js';
import { IMPORTED_ASSET_CACHE } from './assetCache.js';
import { DOWNLOAD_VOICE_TREES } from './voiceDownloads.js';
import { mediaUrl } from './media.js';

/** All non-voice files and one complete manifest-listed dub per voiced charId, independent of download choices. */
export function resourceRequirements(assets, local = null, fx = null) {
	const audio = { ...assets?.audio };
	const operators = new Map();
	for (const [lang, tree] of Object.entries(DOWNLOAD_VOICE_TREES)) {
		for (const [charId, slots] of Object.entries(audio[tree] || {})) {
			const urls = collectAssetUrls(slots);
			if (!urls.length) continue;
			if (!operators.has(charId)) operators.set(charId, []);
			operators.get(charId).push({ lang, urls });
		}
		delete audio[tree];
	}
	const nonVoice = collectAssetUrls({ ...assets, audio }, local, fx);
	if (!nonVoice.length || !operators.size) throw new Error('Incomplete resource manifest');
	const urls = [...new Set([...nonVoice, ...[...operators.values()].flatMap((dubs) => dubs.flatMap((dub) => dub.urls))])];
	// Audio loaded through the original asset fallback may exist under its extension-bearing URL instead.
	const aliases = new Map(urls.map((url) => [url, [url]]));
	const walk = (value) => {
		if (typeof value === 'string') {
			const list = aliases.get(mediaUrl(value));
			if (list && !list.includes(value)) list.push(value);
		} else if (value && typeof value === 'object') Object.values(value).forEach(walk);
	};
	[assets, local, fx].forEach(walk);
	return { nonVoice, operators, urls, aliases };
}

/** Pure summary, reusable by forks with their own local file lookup. A null lookup means not verifiable. */
export function summarizeResources(requirements, available) {
	const missing = requirements.nonVoice.filter((url) => available.get(url) !== true);
	const operators = [...requirements.operators].map(([charId, dubs]) => ({
		charId,
		languages: dubs.filter((dub) => dub.urls.every((url) => available.get(url) === true)).map((dub) => dub.lang),
	}));
	const missingOperators = operators.filter((operator) => !operator.languages.length).map((operator) => operator.charId);
	const unresolved = new Set([...missing, ...missingOperators.flatMap((charId) =>
		requirements.operators.get(charId).flatMap((dub) => dub.urls))]);
	return {
		complete: missing.length === 0 && missingOperators.length === 0,
		nonVoice: { total: requirements.nonVoice.length, ready: requirements.nonVoice.length - missing.length, missing },
		voices: { total: operators.length, ready: operators.length - missingOperators.length, missing: missingOperators, operators },
		unverified: requirements.urls.filter((url) => unresolved.has(url) && available.get(url) == null),
	};
}

async function validBody(response) {
	if (!response?.ok || response.status === 206 || /text\/html/i.test(response.headers.get('content-type') || '')) {
		await response?.body?.cancel();
		return false;
	}
	// Read incrementally: malformed or interrupted bodies must never satisfy completeness.
	if (!response.body?.getReader) return (await response.arrayBuffer()).byteLength > 0;
	const reader = response.body.getReader();
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return size > 0;
			size += value.byteLength;
		}
	} finally { reader.releaseLock(); }
}

/**
 * Check this browser against the three served manifests. Only manifests may use the network.
 * hasResource(url, aliases) may be supplied by downstream clients with a different local asset store.
 * Returns counts, missing file URLs/charIds and the complete locally available languages for each operator.
 * Throws on manifest failure/cancellation instead of reporting a false success.
 */
export async function checkResources({ fetch: doFetch = (...args) => globalThis.fetch(...args), caches: cachesApi = globalThis.caches,
	signal, onProgress = (_progress) => {}, hasResource } = {}) {
	const abort = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
	const manifests = await readServedManifests((url, options) => doFetch(url, { ...options, signal }));
	abort();
	const requirements = resourceRequirements(manifests.assets, manifests.local, manifests.fx);
	let cache = null;
	try { cache = await cachesApi?.open(IMPORTED_ASSET_CACHE); } catch { /* HTTP cache may still be readable. */ }
	const lookup = hasResource || (async (_url, aliases) => {
		let uncertain = false;
		for (const alias of aliases) {
			abort();
			try {
				const hit = await cache?.match(alias);
				if (hit && await validBody(hit)) return true;
			} catch { uncertain = true; }
			try {
				const hit = await doFetch(alias, { cache: 'only-if-cached', mode: 'same-origin', redirect: 'error', signal });
				if (await validBody(hit)) return true;
			} catch { uncertain = true; }
		}
		return uncertain ? null : false;
	});
	const available = new Map();
	let next = 0;
	onProgress({ done: 0, total: requirements.urls.length });
	const worker = async () => {
		while (next < requirements.urls.length) {
			abort();
			const url = requirements.urls[next++];
			const present = await lookup(url, requirements.aliases.get(url));
			abort();
			available.set(url, present === true ? true : present === false ? false : null);
			onProgress({ done: available.size, total: requirements.urls.length });
		}
	};
	await Promise.all(Array.from({ length: 4 }, worker));
	return summarizeResources(requirements, available);
}
