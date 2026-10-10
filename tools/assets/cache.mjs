// Cached upstream JSON indexes needed by the asset pipeline:
//   .cache/gamedata/excel/audio_data.json     (Kengxxiao/ArknightsGameData, zh_CN)
//   .cache/gamedata/excel/charword_table.json (same repo: the operators' voice slots and voice assets)
//   .cache/ark-models/models_data.json        (isHarryh/Ark-Models enemy Spine index)
// Downloaded once when missing (or with --refresh-index), then reused.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RAW } from './sources.mjs';
import { MirrorPolicy } from './network.mjs';
import { guardDefaultFetch } from './env-proxy.mjs';

/**
 * Read a cached JSON file, downloading it first when missing or unparsable.
 * @param {object} o
 * @param {string} o.cacheFile absolute cache path
 * @param {string} o.url raw GitHub URL
 * @param {boolean} [o.refresh] force re-download
 * @param {boolean} [o.offline] never download (throw when the cache is missing)
 * @param {(m:string)=>void} [o.log]
 * @param {'direct'|'mirror'} [o.source]
 * @param {string} [o.proxyPrefix]
 * @param {typeof fetch} [o.fetchImpl]
 * @param {MirrorPolicy} [o.mirrorPolicy] shared invocation-wide mirror circuit breaker
 * @param {number} [o.timeoutMs]
 * @param {number} [o.backoffMs]
 * @param {import('./source-verifier.mjs').SourceVerifier} [o.verifier]
 * @returns {Promise<any>} parsed JSON
 */
export async function cachedJson({ cacheFile, url, refresh = false, offline = false, log = console.log, source = 'direct', proxyPrefix, fetchImpl = globalThis.fetch, mirrorPolicy, timeoutMs = 180000, backoffMs = 500, verifier }) {
  if (verifier && offline) throw new Error('source verification is incompatible with --offline');
  let verifiedSource;
  if (verifier) {
    try {
      verifiedSource = await verifier.resolve(url);
      if (!verifiedSource) throw new Error(`source index missing ${url}`);
    } catch (e) {
      await unlink(cacheFile).catch((err) => { if (err.code !== 'ENOENT') throw err; });
      throw e;
    }
  }
  // Same rule as the file downloader: a configured proxy must not be skipped.
  const fetchFn = guardDefaultFetch(fetchImpl);
  if (!refresh || offline) {
    try {
      const buf = await readFile(cacheFile);
      if (verifier) verifier.verify(buf, verifiedSource);
      return JSON.parse(buf.toString('utf8'));
    } catch (e) {
      if (offline) throw new Error(`--offline: cached index ${cacheFile} is missing or corrupt (${e.message}); run once online`);
    }
  }
  if (verifier) await unlink(cacheFile).catch((err) => { if (err.code !== 'ENOENT') throw err; });
  const network = mirrorPolicy ?? new MirrorPolicy({ source, proxyPrefix, log });
  let lastErr = null;
  for (const src of network.urls(verifiedSource?.pinnedUrl ?? url)) {
    if (network.skip(src)) continue;
    const attempts = network.isProxy(src) ? 1 : 3;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let text, json;
      try {
        log(`[cache] downloading ${src}`);
        const res = await network.request(src, fetchFn, {}, timeoutMs);
        if (!res.ok) {
          await res.body?.cancel();
          if (res.status === 404 || res.status === 410) {
            network.succeeded(src); // missing index, not a proxy outage
            lastErr = new Error(`HTTP ${res.status}`);
            break;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const buf = await network.readBody(src, res);
        if (verifier) verifier.verify(buf, verifiedSource);
        text = buf.toString('utf8');
        json = JSON.parse(text);
      } catch (e) {
        lastErr = e;
        network.failed(src);
        if (attempt < attempts && backoffMs) await new Promise((r) => setTimeout(r, backoffMs * attempt));
        continue;
      }
      network.succeeded(src);
      // A local disk failure is not evidence that the mirror is unhealthy.
      await mkdir(dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile + '.tmp', text);
      await rename(cacheFile + '.tmp', cacheFile);
      return json;
    }
  }
  if (lastErr) network.directFailureHint();
  throw new Error(`cannot fetch ${url}: ${lastErr?.message}`);
}

/**
 * Load audio_data.json (official), charword_table.json (official voice slots) and Ark-Models models_data.json.
 * @param {string} root project root
 * @param {{refresh?:boolean, offline?:boolean, log?:(m:string)=>void, source?:'direct'|'mirror', proxyPrefix?:string, fetchImpl?:typeof fetch, mirrorPolicy?:MirrorPolicy, verifier?:import('./source-verifier.mjs').SourceVerifier}} [opts]
 * @returns {Promise<{ audioData: any, modelsData: any, charword: any }>}
 */
export async function loadIndexes(root, opts = {}) {
  const mirrorPolicy = opts.mirrorPolicy ?? new MirrorPolicy(opts);
  const audioData = await cachedJson({
    ...opts,
    mirrorPolicy,
    cacheFile: join(root, '.cache', 'gamedata', 'excel', 'audio_data.json'),
    url: RAW.gamedata + 'excel/audio_data.json',
    refresh: opts.refresh,
    offline: opts.offline,
    log: opts.log,
  });
  // 11 MB, and raw.githubusercontent stalls on it often: the jsDelivr mirror cachedJson() falls back to is the
  // reliable path (the operator battle voice needs it, plan.mjs indexVoice).
  const charword = await cachedJson({
    ...opts,
    mirrorPolicy,
    cacheFile: join(root, '.cache', 'gamedata', 'excel', 'charword_table.json'),
    url: RAW.gamedata + 'excel/charword_table.json',
    refresh: opts.refresh,
    offline: opts.offline,
    log: opts.log,
  });
  const modelsData = await cachedJson({
    ...opts,
    mirrorPolicy,
    cacheFile: join(root, '.cache', 'ark-models', 'models_data.json'),
    url: RAW.arkModels + 'models_data.json',
    refresh: opts.refresh,
    offline: opts.offline,
    log: opts.log,
  });
  return { audioData, modelsData, charword };
}
