








import { syncActive } from '../../render/shop/cardRecords.js';


export function resolveRecord(records, path, basePath) {
  if (!path) return null;
  if (basePath) {
    const joined = records.byPath(`${basePath}/${path}`);
    if (joined) return joined;
  }
  const direct = records.byPath(path);
  if (direct) return direct;
  const suffix = `/${path}`;
  for (const key of records.paths()) {
    if (key === path || key.endsWith(suffix)) return records.byPath(key);
  }
  return null;
}


function activeAtKey(keys, t) {
  let value = keys[0][1];
  for (const key of keys) {
    if (key[0] <= t) value = key[1];
    else break;
  }
  return Number(value) > 0.5;
}


export function applyActiveCurves(records, clip, t, basePath) {
  let hits = 0;
  for (const [path, prop, keys] of (clip && clip.curves) || []) {
    if (prop !== 'active') continue;
    const rec = resolveRecord(records, path, basePath);
    if (!rec || !keys || !keys.length) continue;
    rec.node.active = activeAtKey(keys, t);
    hits += 1;
  }
  return hits;
}


export function applyClipsFrame(records, clips, applyClip) {
  for (const entry of clips || []) {
    const { clip, t, basePath = null } = entry;
    if (!clip) continue;
    applyActiveCurves(records, clip, t, basePath);
  }

  for (const root of records.trees || []) syncActive(root, records, true);
  for (const entry of clips || []) {
    const { clip, t, basePath = null } = entry;
    if (!clip) continue;
    if (applyClip) applyClip(records, clip, t, basePath, true);
  }
}
