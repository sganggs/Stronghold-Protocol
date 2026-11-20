/**
 * Derive the render metadata from the theme documents themselves.
 *
 * `shop.json`/`card.json` now carry each node's real prefab `pathID` (from
 * tools/local-extract/legacy/path_ids.py).  The status-driver descriptions
 * already carry GAME_OBJECT `pid` values; `colorGroup.nodes` carries the full
 * `_colorElements` id list.  This adapter turns both into the shapes the
 * existing host/renderer consumes, without the older mapping files
 * (`pathid_map.json` / `tint_targets.json`).
 *
 * Pure: both maps are rebuilt from the documents on every call, no cache.
 */

const PANEL_ROOT = 'panel_shop_main';
const CARD_ROOT = 'autochess_shop_card_item';

function walk(node, rootName, out) {
  if (!node || typeof node !== 'object') return;
  out.push({ node, rootName });
  for (const child of node.children || []) walk(child, rootName, out);
}

function index(doc, rootName) {
  const byId = new Map();
  const byPathId = new Map();
  const rows = [];
  if (doc && doc.root) walk(doc.root, rootName, rows);
  for (const { node } of rows) {
    if (node.id != null) byId.set(String(node.id), node);
    if (node.pathID != null) byPathId.set(String(node.pathID), node);
  }
  return { rows, byId, byPathId };
}

function relative(node, rootName) {
  if (!node || !node.path) return null;
  const prefix = `${rootName}/`;
  return node.path.startsWith(prefix) ? node.path.slice(prefix.length) : node.path;
}

function tintPaths(indexed, rootName, groupName) {
  const paths = [];
  const seen = new Set();
  for (const { node } of indexed.rows) {
    if (!node.colorGroup || !Array.isArray(node.colorGroup.nodes)) continue;
    if (groupName && node.name !== groupName) continue;
    for (const id of node.colorGroup.nodes) {
      const target = indexed.byId.get(String(id));
      const rel = relative(target, rootName);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      paths.push(rel);
    }
  }
  return paths;
}

/**
 * @param {{shop: any, card: any}} docs
 * @returns {{tintTargets: {panel: string[], card: string[]}, pathIdMap: {statusEntries: object[]}}}
 */
export function buildShopMeta(docs = {}) {
  const shop = docs.shop || {};
  const card = docs.card || {};
  const shopPanel = shop.prefabs && shop.prefabs[PANEL_ROOT];
  const panel = index({ root: shopPanel && shopPanel.root }, PANEL_ROOT);
  const cardIndex = index({ root: card.root }, CARD_ROOT);

  const tintTargets = {
    panel: tintPaths(panel, PANEL_ROOT, 'hotspot_normal'),
    card: tintPaths(cardIndex, CARD_ROOT, 'hot_spot'),
  };

  const statusEntries = [];
  for (const [rootName, indexed] of [[PANEL_ROOT, panel], [CARD_ROOT, cardIndex]]) {
    for (const { node } of indexed.rows) {
      for (const comp of node.components || []) {
        if (!comp || comp.class !== 'UIViewStatusDriver') continue;
        const entries = (comp.fields && comp.fields._statusEntries) || [];
        for (const status of entries) {
          for (const description of status.descriptions || []) {
            const pid = description && description.gameObject && description.gameObject.pid;
            if (pid == null) continue;
            const target = indexed.byPathId.get(String(pid));
            if (!target) continue;
            statusEntries.push({
              prefab: rootName,
              statusName: status.statusName,
              descriptionType: description.descriptionType,
              active: description.active,
              targets: {
                gameObject: { resolved: true, path: target.path },
              },
            });
          }
        }
      }
    }
  }

  return { tintTargets, pathIdMap: { statusEntries } };
}

export const META_ROOTS = Object.freeze({ panel: PANEL_ROOT, card: CARD_ROOT });
