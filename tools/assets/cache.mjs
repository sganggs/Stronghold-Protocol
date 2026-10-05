// Cached upstream JSON indexes needed by the asset pipeline:
//   .cache/gamedata/excel/audio_data.json     (Kengxxiao/ArknightsGameData, zh_CN)
//   .cache/gamedata/excel/charword_table.json (same repo: the operators' voice slots and voice assets)
//   .cache/ark-models/models_data.json        (isHarryh/Ark-Models enemy Spine index)
// Downloaded once when missing (or with --refresh-index), then reused.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RAW, mirrorUrl } from './sources.mjs';

/**
 * Read a cached JSON file, downloading it first when missing or unparsable.
 * @param {object} o
 * @param {string} o.cacheFile absolute cache path
 * @param {string} o.url raw GitHub URL
 * @param {boolean} [o.refresh] force re-download
 * @param {boolean} [o.offline] never download (throw when the cache is missing)
 * @param {(m:string)=>void} [o.log]
 * @returns {Promise<any>} parsed JSON
 */
export async function cachedJson({ cacheFile, url, refresh = false, offline = false, log = console.log }) {
  if (!refresh || offline) {
    try { return JSON.parse(await readFile(cacheFile, 'utf8')); } catch (e) {
      if (offline) throw new Error(`--offline: cached index ${cacheFile} is missing or corrupt (${e.message}); run once online`);
    }
  }
  let lastErr = null;
  for (const src of [url, mirrorUrl(url)].filter(Boolean)) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        log(`[cache] downloading ${src}`);
        const res = await fetch(src, { signal: AbortSignal.timeout(180000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const json = JSON.parse(text);
        await mkdir(dirname(cacheFile), { recursive: true });
        await writeFile(cacheFile + '.tmp', text);
        await rename(cacheFile + '.tmp', cacheFile);
        return json;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw new Error(`cannot fetch ${url}: ${lastErr?.message}`);
}

/**
 * Load audio_data.json (official), charword_table.json (official voice slots) and Ark-Models models_data.json.
 * @param {string} root project root
 * @param {{refresh?:boolean, offline?:boolean, log?:(m:string)=>void}} [opts]
 * @returns {Promise<{ audioData: any, modelsData: any, charword: any }>}
 */
export async function loadIndexes(root, opts = {}) {
  const audioData = await cachedJson({
    cacheFile: join(root, '.cache', 'gamedata', 'excel', 'audio_data.json'),
    url: RAW.gamedata + 'excel/audio_data.json',
    refresh: opts.refresh,
    offline: opts.offline,
    log: opts.log,
  });
  // 11 MB, and raw.githubusercontent stalls on it often: the jsDelivr mirror cachedJson() falls back to is the
  // reliable path (the operator battle voice needs it, plan.mjs indexVoice).
  const charword = await cachedJson({
    cacheFile: join(root, '.cache', 'gamedata', 'excel', 'charword_table.json'),
    url: RAW.gamedata + 'excel/charword_table.json',
    refresh: opts.refresh,
    offline: opts.offline,
    log: opts.log,
  });
  const modelsData = await cachedJson({
    cacheFile: join(root, '.cache', 'ark-models', 'models_data.json'),
    url: RAW.arkModels + 'models_data.json',
    refresh: opts.refresh,
    offline: opts.offline,
    log: opts.log,
  });
  return { audioData, modelsData, charword };
}
