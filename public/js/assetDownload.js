// Explicit title-screen predownload. Reuse the game's HTTP cache and exact manifest URLs;
// never decode every model/image/audio file into RAM or persist an unverified "complete" flag.
// A URL already stored by a local import (assetPack.js) is marked done and not requested again.
import { mediaUrl } from './media.js';
import { listImportedPaths } from './assetCache.js';
import { DOWNLOAD_VOICE_TREES, downloadVoiceLanguages, voiceDownloadStore } from './voiceDownloads.js';

/**
 * Collect only same-origin art files, including all Spine pages and optional local scenes.
 * The served 0.3.0 views are walked as they are: hashed `/assets/~…` and `/fonts/~…` URLs, the extra dub banks
 * (`voiceEn` / `voiceKr` / `voiceNative`, filtered before queuing), statistics-page art and local groups. A cosmetic
 * plugin's own files are `/p/<id>/<hash8>/…` and are not in these manifests, so they are not queued here. The official
 * battle effects (DESIGN §33) come in their own manifest, /data/local-fx.json, read the same way when the host has them.
 */
export function collectAssetUrls(...manifests) {
  const urls = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      if (/^\/(?:assets|fonts)\/[^/]/.test(value) && !/[?#\\]/.test(value)) urls.add(mediaUrl(value));
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) visit(child);
    }
  };
  manifests.forEach(visit);
  // Fetch models/images before audio, so an interrupted download still improves battle visuals.
  return [...urls].sort((a, b) => Number(a.startsWith('/media/')) - Number(b.startsWith('/media/')) || a.localeCompare(b));
}

/** Keep only the explicitly selected download dubs per operator; never mutate the served manifest. */
export function selectVoiceAssets(manifest, settings) {
	const audio = manifest?.audio;
	if (!audio || typeof audio !== 'object') return manifest;
	const selected = { ...audio };
	for (const [lang, tree] of Object.entries(DOWNLOAD_VOICE_TREES)) {
		selected[tree] = Object.fromEntries(Object.entries(audio[tree] || {}).filter(([charId]) =>
			downloadVoiceLanguages(settings, charId, audio).includes(lang)));
	}
	return { ...manifest, audio: selected };
}

/** A bounded, pausable download queue. A file counts only after its entire body arrives. */
export function createAssetDownload({ fetch: doFetch = (...args) => globalThis.fetch(...args),
  concurrency = 4, timeoutMs = 60000, retries = 2, lookupImported = listImportedPaths, readVoiceSettings = () => voiceDownloadStore.get() } = {}) {
  let state = { phase: 'idle', total: 0, done: 0, bytes: 0, failures: [], localMissing: false, cached: 0 };
	let voiceKey = null, voiceSettings = null;
  let urls = null, running = null, controller = null, paused = false, lastNotice = 0;
  const complete = new Set(), failures = new Map(), listeners = new Set();
  const emit = (force = false) => {
    if (!force && Date.now() - lastNotice < 100) return;
    lastNotice = Date.now();
    state = { ...state, done: complete.size, failures: [...failures.values()] };
    for (const listener of listeners) listener(state);
  };

  async function request(url, json = false, optional = false) {
    for (let attempt = 0; ; attempt++) {
      const abort = new AbortController();
      const cancel = () => abort.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      if (controller.signal.aborted) cancel();
      const timer = setTimeout(cancel, timeoutMs);
      try {
        const response = await doFetch(url, { signal: abort.signal, cache: json ? 'no-cache' : 'default' });
        if (optional && response.status === 404) { await response.body?.cancel(); return null; }
        if (!response.ok || response.status === 206) {
          await response.body?.cancel();
          throw Object.assign(new Error('Asset request failed'), { status: response.status });
        }
        // Static hosts sometimes send their HTML fallback with status 200 for missing art.
        if (/text\/html/i.test(response.headers.get('content-type') || '')) {
          await response.body?.cancel();
          throw Object.assign(new Error('Unexpected HTML response'), { status: 'html' });
        }
        if (json) return await response.json();
        let size = 0;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              state = { ...state, bytes: state.bytes + value.byteLength };
              emit();
            }
          } finally { reader.releaseLock(); }
        } else {
          size = (await response.arrayBuffer()).byteLength;
          state = { ...state, bytes: state.bytes + size };
        }
        if (!size) throw Object.assign(new Error('Empty asset response'), { status: 'empty' });
        return;
      } catch (error) {
        if (paused) throw error;
        const transient = !error.status || error.status >= 500 || [408, 429].includes(error.status);
        if (!transient || attempt >= retries) throw Object.assign(error, { url });
        // Keep retries bounded and avoid hammering a struggling server.
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        if (paused) throw error;
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', cancel);
      }
    }
  }

  async function run() {
    try {
      if (!urls) {
        state = { ...state, phase: 'preparing', error: null };
        emit(true);
        // Sequential manifest reads keep cancellation simple and never leave a rejected sibling promise.
        const assets = await request('/data/assets.json', true);
        const local = await request('/data/local-assets.json', true, true);
        // the official battle effects' files (DESIGN §33): optional, like the local manifest
        const fx = await request('/data/local-fx.json', true, true);
        if (!assets || typeof assets !== 'object' || Array.isArray(assets)
          || (local !== null && (!local || typeof local !== 'object' || !local.groups))
          || (fx !== null && (!fx || typeof fx !== 'object' || !fx.groups))) throw new Error('Invalid asset manifest');
				const list = collectAssetUrls(selectVoiceAssets(assets, voiceSettings), local, fx);
        if (!list.length) throw new Error('Empty asset manifest');
        urls = list;
        state = { ...state, total: urls.length, localMissing: local === null };
      }
      if (paused) return;
      let imported = null;
      try { imported = await lookupImported(); } catch { imported = null; }
      if (paused) return;
      let cached = 0;
      if (imported && typeof imported.has === 'function') {
        for (const url of urls) {
          let path = url;
          try { path = new URL(url, 'http://localhost').pathname; } catch { /* keep the queue string */ }
          if (imported.has(url) || imported.has(path)) {
            cached++;
            complete.add(url);
          }
        }
      }
      state = { ...state, cached };
      if (paused) return;
      state = { ...state, phase: 'downloading' };
      failures.clear();
      emit(true);
      const queue = urls.filter((url) => !complete.has(url));
      let next = 0;
      const worker = async () => {
        while (!paused && next < queue.length) {
          const url = queue[next++];
          try {
            await request(url);
            complete.add(url);
          } catch (error) {
            if (!paused) failures.set(url, { url, status: error.status || 'network' });
          }
          emit();
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, worker));
      if (!paused) state = { ...state, phase: failures.size ? 'partial' : 'complete' };
    } catch (error) {
      if (!paused) state = { ...state, phase: 'error', error: { url: error.url, status: error.status || 'manifest' } };
    } finally {
      if (paused) state = { ...state, phase: 'paused' };
      emit(true);
    }
  }

  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() {
      if (running) return running;
      paused = false;
      controller = new AbortController();
			const nextSettings = readVoiceSettings();
			const nextKey = JSON.stringify(nextSettings);
			const changed = voiceKey !== nextKey;
			voiceKey = nextKey;
			voiceSettings = nextSettings;
      // A new check after completion revalidates the manifest and all files through the HTTP cache.
      if (state.phase === 'complete' || changed) {
        urls = null; complete.clear();
        state = { phase: 'idle', total: 0, done: 0, bytes: 0, failures: [], localMissing: false, cached: 0 };
      }
      running = run().finally(() => { running = null; });
      return running;
    },
    pause() { if (running) { paused = true; controller.abort(); } },
  };
}

export const assetDownload = createAssetDownload();
