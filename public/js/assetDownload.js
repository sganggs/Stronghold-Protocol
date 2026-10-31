// Explicit title-screen predownload of the exact manifest URLs; never decode every model/image/audio file into RAM or
// persist an unverified "complete" flag. In a secure context each downloaded file is also kept in the import cache
// (assetCache.js openDownloadStore, GitHub #725), which the worker answers from; elsewhere only the HTTP cache keeps it.
// A URL already stored there — by a local import (assetPack.js) or an earlier download — is marked done and not
// requested again.
import { mediaUrl } from './media.js';
import { listImportedPaths, openDownloadStore } from './assetCache.js';

/**
 * Collect only same-origin art files, including all Spine pages and optional local scenes.
 * The served 0.3.0 views are walked as they are: hashed `/assets/~…` and `/fonts/~…` URLs, the extra dub banks
 * (`voiceEn` / `voiceKr` / `voiceNative`), statistics-page art, and local groups such as the 射击台 mesh. A cosmetic
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

/** A bounded, pausable download queue. A file counts only after its entire body arrives. */
export function createAssetDownload({ fetch: doFetch = (...args) => globalThis.fetch(...args),
  concurrency = 4, timeoutMs = 60000, retries = 2, lookupImported = listImportedPaths, openStore = openDownloadStore } = {}) {
  // `storage`: where downloads are kept — 'site' (the import cache), 'http' (the HTTP cache only: no secure context or no
  // Cache Storage), 'full' (a write failed, e.g. over quota: the rest of this run goes to the HTTP cache only)
  let state = { phase: 'idle', total: 0, done: 0, bytes: 0, failures: [], localMissing: false, cached: 0, storage: null };
  let urls = null, running = null, controller = null, paused = false, lastNotice = 0, keeper = null;
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
        const chunks = keeper ? [] : null;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              chunks?.push(value);
              state = { ...state, bytes: state.bytes + value.byteLength };
              emit();
            }
          } finally { reader.releaseLock(); }
        } else {
          const body = new Uint8Array(await response.arrayBuffer());
          size = body.byteLength;
          chunks?.push(body);
          state = { ...state, bytes: state.bytes + size };
        }
        if (!size) throw Object.assign(new Error('Empty asset response'), { status: 'empty' });
        if (chunks) await keep(url, chunks, size, response.headers.get('content-type'));
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

  /** Keep a whole body in the import cache; a failed write (over quota …) sends the rest of the run to the HTTP cache. */
  async function keep(url, chunks, size, type) {
    const store = keeper;
    if (!store) return;
    const body = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { body.set(chunk, at); at += chunk.byteLength; }
    try {
      await store.put(url, body, type || undefined);
    } catch {
      if (keeper === store) { keeper = null; state = { ...state, storage: 'full' }; }
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
        const list = collectAssetUrls(assets, local, fx);
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
      try { keeper = await openStore(); } catch { keeper = null; }
      state = { ...state, storage: keeper ? 'site' : 'http' };
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
      // the stored files reach the import index, so the next check counts them ready and requests none of them
      if (keeper) { try { await keeper.flush(); } catch { /* the entries stay; the worker still answers them */ } }
      keeper = null;
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
      // A new check after completion revalidates the manifest and all files through the HTTP cache.
      if (state.phase === 'complete') {
        urls = null; complete.clear();
        state = { phase: 'idle', total: 0, done: 0, bytes: 0, failures: [], localMissing: false, cached: 0, storage: null };
      }
      running = run().finally(() => { running = null; });
      return running;
    },
    pause() { if (running) { paused = true; controller.abort(); } },
  };
}

export const assetDownload = createAssetDownload();
