// Spine (3.8-style) texture-atlas parsing and normalization.
//
// Semantics follow pixi-spine 4's TextureAtlas reader (the runtime we ship):
// a page starts at the first non-blank line after a blank line (or file start);
// the page name is followed by `key: value` page fields (size/format/filter/
// repeat/pma); every other non-blank line starts a region, whose `key: value`
// lines follow it. Normalization (research 07 §5.3):
//   - insert `size: W,H` right after the page name when missing (fexli atlases
//     omit it; spine-ts divides by 0 and pixi-spine warns), or correct it when it
//     disagrees with the real PNG size;
//   - insert `pma: true` for premultiplied-alpha textures (Ark-Models enemies).
// Normalization is idempotent: running it twice yields the same text.
// The asset pipeline re-exports this module; the service worker imports it too.

/**
 * @typedef {{ name: string, line: number, fields: Record<string,string>, fieldLines: Record<string,number>, lastFieldLine: number, regions: string[] }} AtlasPage
 */

function splitEntry(line) {
  const t = line.trim();
  if (!t) return null;
  const colon = t.indexOf(':');
  if (colon === -1) return null;
  return [t.slice(0, colon).trim(), t.slice(colon + 1).trim()];
}

/**
 * Parse an atlas into pages (with page fields and region names).
 * @param {string} text
 * @returns {{ lines: string[], pages: AtlasPage[] }}
 */
export function parseAtlas(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  /** @type {AtlasPage[]} */
  const pages = [];
  let page = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { page = null; i++; continue; }
    if (page === null) {
      page = { name: line.trim(), line: i, fields: {}, fieldLines: {}, lastFieldLine: i, regions: [] };
      pages.push(page);
      i++;
      while (i < lines.length) {
        const e = splitEntry(lines[i]);
        if (!e) break;
        page.fields[e[0]] = e[1];
        page.fieldLines[e[0]] = i;
        page.lastFieldLine = i;
        i++;
      }
      continue;
    }
    page.regions.push(line);
    i++;
    while (i < lines.length && splitEntry(lines[i])) i++;
  }
  return { lines, pages };
}

/**
 * Normalize an atlas text.
 * @param {string} text original atlas text
 * @param {object} opts
 * @param {(pageName:string)=>({width:number,height:number}|null)} opts.pageSize real texture size lookup
 * @param {boolean} [opts.pma] add `pma: true` to every page
 * @param {(pageName:string)=>string} [opts.renamePage] local file name for a page (rewrites the page line)
 * @returns {{ text: string, changed: boolean, pages: string[], missingSize: string[], fixedSize: string[] }}
 */
export function normalizeAtlas(text, { pageSize, pma = false, renamePage = null }) {
  const { lines, pages } = parseAtlas(text);
  /** insertions after a given line index: Map<lineIndex, string[]> */
  const inserts = new Map();
  const replace = new Map();
  const missingSize = [];
  const fixedSize = [];
  const addAfter = (idx, s) => { if (!inserts.has(idx)) inserts.set(idx, []); inserts.get(idx).push(s); };
  for (const p of pages) {
    if (renamePage) {
      const local = renamePage(p.name);
      if (typeof local === 'string' && local && local !== p.name) replace.set(p.line, local);
    }
    const real = pageSize ? pageSize(p.name) : null;
    if (p.fields.size === undefined) {
      if (real) addAfter(p.line, `size: ${real.width},${real.height}`);
      else missingSize.push(p.name);
    } else if (real) {
      const m = /^(\d+)\s*,\s*(\d+)$/.exec(p.fields.size);
      if (!m || Number(m[1]) !== real.width || Number(m[2]) !== real.height) {
        replace.set(p.fieldLines.size, `size: ${real.width},${real.height}`);
        fixedSize.push(p.name);
      }
    }
    if (pma && p.fields.pma === undefined) {
      addAfter(p.lastFieldLine, 'pma: true');
    }
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(replace.has(i) ? replace.get(i) : lines[i]);
    const extra = inserts.get(i);
    if (extra) {
      extra.sort((a, b) => (a.startsWith('size:') ? -1 : 0) - (b.startsWith('size:') ? -1 : 0));
      out.push(...extra);
    }
  }
  const result = out.join('\n');
  const original = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  return { text: result, changed: result !== original, pages: pages.map((p) => (replace.get(p.line) ?? p.name)), missingSize, fixedSize };
}

/**
 * List page image names and region names of an atlas.
 * @param {string} text
 * @returns {{ pages: string[], regions: Set<string>, hasSize: boolean, hasPma: boolean }}
 */
export function atlasInfo(text) {
  const { pages } = parseAtlas(text);
  const regions = new Set();
  for (const p of pages) for (const r of p.regions) regions.add(r);
  return {
    pages: pages.map((p) => p.name),
    regions,
    hasSize: pages.length > 0 && pages.every((p) => /^\d+\s*,\s*\d+$/.test(p.fields.size || '')),
    hasPma: pages.length > 0 && pages.every((p) => p.fields.pma === 'true'),
  };
}
