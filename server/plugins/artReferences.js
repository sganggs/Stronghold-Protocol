// Optional local art for installed official operators outside the shipped roster (§34.28).
// Uses W5's bounded JSON-only reader, including disabled plugins; never loads plugin code.
import fs from 'node:fs';
import path from 'node:path';
import { installedFxReferences } from './fxReferences.js';
import { ASSET_CONTAINERS, getPath, readAssetOverlay } from '../../shared/plugins/visual.js';
import { issueList } from '../../shared/plugins/errors.js';

const read = (root, rel) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return {}; }
};

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
/** [ASSUMED] At most 256 distinct official operators per installation/run, shared with operators.py. */
export const ART_REFERENCE_LIMIT = 256;

/** Optional extracted art belongs to the installation's base, before cosmetic layers.
 * [ASSUMED] Existing base slots win; absent slots use local art. No author-facing fields are added. */
export function mergeLocalChars(base, local) {
  if (!isObj(base) || !isObj(local?.chars)) return base;
  const entries = Object.entries(local.chars).filter(([id, art]) => /^char_[0-9]+_[a-z0-9]+$/.test(id) && isObj(art));
  if (!entries.length) return base;
  const chars = { ...base.chars };
  for (const [id, art] of entries) {
    const existing = chars[id] || {};
    chars[id] = { ...art, ...existing };
    if (art.spine || existing.spine) chars[id].spine = { ...art.spine, ...existing.spine };
  }
  return { ...base, chars };
}

/** Validate references against merged art, permissions against the original data/assets.json.
 * Keep this installation policy server-side: changing shared visual code would change vanilla's content hash.
 * @param {unknown} assets
 * @param {{ vanilla?: import('./registry.js').VanillaAssets, permissions?: string[] | null,
 *   has?: ((rel: string) => boolean) | null }} [ctx]
 */
export function readInstalledAssetOverlay(assets, { vanilla, permissions = null, has = null } = {}) {
  const base = vanilla?.baseManifest ?? vanilla?.manifest;
  const merged = vanilla?.manifest;
  if (base === merged) return readAssetOverlay(assets, { vanilla: merged, permissions, has });
  const ov = readAssetOverlay(assets, { vanilla: merged, has });
  const list = issueList();
  list.take(ov);
  if (base && Array.isArray(permissions)) {
    const told = new Set();
    // Same entry-level classification as shared/plugins/visual.js; local-only entries remain additions.
    for (const op of ov.ops) {
      if (op.implied) continue;
      const depth = ASSET_CONTAINERS.find(c => c.path.every((k, i) => op.at[i] === k))?.path.length ?? 1;
      const exists = getPath(base, op.at.slice(0, depth + 1)) !== undefined;
      const need = exists ? 'assets.override' : 'assets.add';
      if (!permissions.includes(need) && !told.has(need)) {
        told.add(need);
        list.problem('PLUGIN_PERMISSION_MISSING', `assets.${op.at.join('.')}: ${exists ? 'changes an entry of this installation\'s manifest' : 'adds an entry'} — needs the permission "${need}"`,
          { at: ['assets', ...op.at], need, needs: [need] });
      }
    }
  }
  return { ...ov, problems: list.problems, warnings: list.warnings, issues: list.issues };
}

export function installedArtReferences(root) {
  const chess = read(root, 'data/chess.json'), backups = read(root, 'data/backups.json');
  const table = read(root, '.cache/gamedata/excel/character_table.json');
  if (!isObj(table)) return [];
  const roster = new Set([...Object.values(chess).map(r => r?.charId), ...Object.keys(backups.units || {})]);
  // Syntax alone does not identify an official operator. Missing tables authorize no art discovery.
  return installedFxReferences(root, { artPhases: true }).filter(id => Object.hasOwn(table, id) && !roster.has(id)).slice(0, ART_REFERENCE_LIMIT);
}

/** [ASSUMED] Base pictures and both battle directions are required; E2 pictures only for a three-phase operator.
 * Missing files count as a gap too (copying a manifest alone does not install art). */
export function pluginArtGap(root) {
  const local = read(root, 'data/local-assets.json'), table = read(root, '.cache/gamedata/excel/character_table.json');
  const present = url => {
    if (typeof url !== 'string' || !/^\/assets\/local\/[A-Za-z0-9_./-]+$/.test(url)
      || url.split('/').some(p => p === '.' || p === '..')) return false;
    try { return fs.statSync(path.join(root, 'public', url)).isFile(); } catch { return false; }
  };
  return installedArtReferences(root).filter(id => {
    const art = local.chars?.[id];
    const pics = ['avatar', 'portrait', ...(table[id]?.phases?.length >= 3 ? ['avatarE2', 'portraitE2'] : [])];
    if (pics.some(k => !present(art?.[k]))) return true;
    return ['front', 'back'].some(face => {
      const m = art?.spine?.[face];
      return !m || !present(m.skel) || !present(m.atlas) || !m.textures?.length || !m.textures.every(present);
    });
  });
}
