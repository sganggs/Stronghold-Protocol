// Installed plugin JSON only; never load a plugin module. Extraction is local and optional (§34.18).
import fs from 'node:fs';
import path from 'node:path';

const CHAR = /^char_[0-9]+_[a-z0-9]+$/;
/** [ASSUMED] Bound discovery independently of installation/validation (also reads disabled packs). */
export const FX_REFERENCE_LIMITS = Object.freeze({ plugins: 256, files: 64, bytes: 8 * 1024 * 1024, nodes: 100000, depth: 24 });
export function officialFxReferences(doc, { artPhases = false } = {}) {
  const ids = new Set();
  let left = FX_REFERENCE_LIMITS.nodes;
  const walk = (v, context = '', depth = 0) => {
    if (--left < 0 || depth > FX_REFERENCE_LIMITS.depth) return;
    if (typeof v === 'string') {
      // Art ids use the renderer's base/_1/_2 convention. Effect units remain exact, even for the art reader.
      const id = artPhases && ['art', 'assets'].includes(context) ? v.replace(/_[12]$/, '') : v;
      if (CHAR.test(id) && /^(charId|unit|art|assets|ref)$/.test(context)) ids.add(id);
      return;
    }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (CHAR.test(k)) ids.add(k);
      walk(x, ['art', 'assets'].includes(context) ? context : k, depth + 1);
    }
  };
  walk(doc);
  return [...ids].sort();
}

export function installedFxReferences(root, opts = {}) {
  const ids = new Set(), dir = path.join(root, 'plugins');
  const read = (base, rel) => {
    if (typeof rel !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*\.json$/.test(rel) || rel.split('/').some(p => p === '..' || p === '.')) return null;
    const abs = path.join(base, rel);
    try {
      // Reject links in every path component, even links pointing back inside the folder.
      let p = base;
      for (const part of rel.split('/')) { p = path.join(p, part); if (fs.lstatSync(p).isSymbolicLink()) return null; }
      if (fs.statSync(abs).size > FX_REFERENCE_LIMITS.bytes) return null;
      return JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch { return null; }
  };
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const ent of names.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')).sort((a, b) => a.name.localeCompare(b.name)).slice(0, FX_REFERENCE_LIMITS.plugins)) {
    const base = path.join(dir, ent.name), man = read(base, 'plugin.json');
    if (!man) continue;
    for (const id of officialFxReferences(man, opts)) ids.add(id);
    const rels = new Set();
    for (const part of ['operators', 'data', 'assets', 'enemies']) for (const rel of [].concat(man[part] || [])) if (typeof rel === 'string') rels.add(rel);
    for (const rel of [...rels].slice(0, FX_REFERENCE_LIMITS.files)) for (const id of officialFxReferences(read(base, rel), opts)) ids.add(id);
  }
  return [...ids].sort();
}

/** A new reference absent from the actual index, including installations without any extracted effects. */
export function pluginFxGap(references, index) {
  return references.filter(id => !Object.hasOwn(index?.units || {}, id)).sort();
}
