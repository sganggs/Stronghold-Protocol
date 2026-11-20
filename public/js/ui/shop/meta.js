// Stage B prefab metadata: the two derived tables the ported panels consume but the theme documents
// do not carry as such.
//
//   tintTargets { card: string[], panel: string[] }
//     Node paths (relative to each root) whose Color the prefab's UIColorGraphic._colorElements names;
//     UIButton uses them for the hover/press tint.
//   pathIdMap { statusEntries: [{ prefab, statusName, descriptionType, active,
//                                 targets: { gameObject: { resolved, path } } }] }
//     The shape UIViewStatusDriver.fromPathIdMap reads: a GAME_OBJECT status action needs the target
//     node's path, which the status description only names by prefab pathID.
//
// The shop extractor writes per-node pathID and the full _colorElements; adapter/prefabMeta.js
// derives these tables from the shop/card documents. This module is the host's consumption contract and
// validator only: it never fetches the lab's metadata JSON files and never guesses a pid→path mapping.

const CARD_PREFIX = 'autochess_shop_card_item';
const PANEL_PREFIX = 'panel_shop_main';

const str = (value) => (typeof value === 'string' && value ? value : null);

/** Strip a document root prefix; the contracts are root-relative. @param {string} path @param {string} prefix */
function stripRoot(path, prefix) {
  const value = String(path);
  if (value === prefix) return '';
  return value.startsWith(`${prefix}/`) ? value.slice(prefix.length + 1) : value;
}

/** @param {any} list @param {string} prefix */
function normalisePaths(list, prefix) {
  const out = [];
  const seen = new Set();
  let dropped = 0;
  if (!Array.isArray(list)) return { paths: [], dropped: 0 };
  for (const item of list) {
    const raw = str(item);
    if (!raw) { dropped += 1; continue; }
    const path = stripRoot(raw, prefix);
    if (!path || seen.has(path)) { if (!path) dropped += 1; continue; }
    seen.add(path);
    out.push(path);
  }
  return { paths: out, dropped };
}

/** @param {any} entry */
function normaliseStatusEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const statusName = str(entry.statusName);
  const prefab = str(entry.prefab);
  const descriptionType = Number(entry.descriptionType);
  const target = entry.targets && entry.targets.gameObject;
  const path = target && str(target.path);
  if (!statusName || !prefab || !Number.isFinite(descriptionType) || !path) return null;
  return {
    prefab,
    statusName,
    descriptionType,
    active: Number(entry.active) || 0,
    targets: { gameObject: { resolved: true, path } },
  };
}

/**
 * Validate/normalise a prefab-meta object (buildShopMeta output or an explicit override).
 * @param {any} raw
 * @returns {{ tintTargets: { card: string[], panel: string[] }|null, pathIdMap: { statusEntries: any[] }|null,
 *   stats: { tintCard: number, tintPanel: number, pathIds: number, dropped: number } }}
 */
export function normaliseShopMeta(raw) {
  const stats = { tintCard: 0, tintPanel: 0, pathIds: 0, dropped: 0 };
  const tint = raw && raw.tintTargets && typeof raw.tintTargets === 'object' ? raw.tintTargets : null;
  let tintTargets = null;
  if (tint && (Array.isArray(tint.card) || Array.isArray(tint.panel))) {
    const card = normalisePaths(tint.card, CARD_PREFIX);
    const panel = normalisePaths(tint.panel, PANEL_PREFIX);
    stats.dropped += card.dropped + panel.dropped;
    stats.tintCard = card.paths.length;
    stats.tintPanel = panel.paths.length;
    tintTargets = { card: card.paths, panel: panel.paths };
  }
  const map = raw && raw.pathIdMap && typeof raw.pathIdMap === 'object' ? raw.pathIdMap : null;
  let pathIdMap = null;
  if (map && Array.isArray(map.statusEntries)) {
    const entries = [];
    for (const entry of map.statusEntries) {
      const next = normaliseStatusEntry(entry);
      if (next) entries.push(next); else stats.dropped += 1;
    }
    stats.pathIds = entries.length;
    pathIdMap = entries.length ? { statusEntries: entries } : null;
  }
  return { tintTargets, pathIdMap, stats };
}

/**
 * Resolve the metadata the host hands to ShopScene, in priority order:
 *   1. `options.prefabMeta`            an object (buildShopMeta() output or a test fixture)
 *   2. `options.tintTargets`/`pathIdMap` explicit partial overrides
 *   3. `options.loadPrefabMeta`        an injected async loader (adapter/prefabMeta.js)
 *   4. nothing                         → both tables null (Stage A behaviour; renderer keeps working)
 *
 * A loader that throws is treated as "not available": the host must never fail to mount over optional
 * tint/status data.
 * @param {{ options?: any, loadPrefabMeta?: Function| null }} [opts]
 */
export async function resolveShopMeta(opts = {}) {
  const options = opts.options || {};
  const loader = opts.loadPrefabMeta !== undefined ? opts.loadPrefabMeta : options.loadPrefabMeta;
  const empty = { tintTargets: null, pathIdMap: null, source: 'none', stats: { tintCard: 0, tintPanel: 0, pathIds: 0, dropped: 0 } };

  if (options.prefabMeta) {
    const meta = normaliseShopMeta(options.prefabMeta);
    return { ...meta, source: 'options.prefabMeta' };
  }
  if (options.tintTargets || options.pathIdMap) {
    const meta = normaliseShopMeta({ tintTargets: options.tintTargets, pathIdMap: options.pathIdMap });
    return { ...meta, source: 'options' };
  }
  if (typeof loader === 'function') {
    try {
      const raw = await loader();
      const meta = normaliseShopMeta(raw);
      return { ...meta, source: 'loader' };
    } catch {
      return { ...empty, source: 'loader-failed' };
    }
  }
  return empty;
}
