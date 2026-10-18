// server/studio/edit.js — what the studio changes in a plugin (DESIGN §32.9, docs/PLUGINS.md §15): plugin.json and its asset
// overlay edited as data, never as text a person has to get right — the basic fields (name, description, version,
// authors, license, credits, homepage, scope), a slot's value (a file the author dropped, a reference to the
// installation's art, nothing), and the one-click fixes of the error catalogue (shared/plugins/errors.js `autofix`).
//
// The overlay is the manifest's `assets` part: inline in plugin.json (the studio's own plugins) or the .json file it names
// (edited there). plugin.json is written back with two spaces and a final newline (manifestText): a person editing it by
// hand meanwhile keeps their file as long as the studio is not asked to change it.

import { readPluginFolder } from '../plugins/registry.js';
import { operatorTraitPermissions } from '../plugins/operatorTraits.js';
import fs from 'node:fs';
import { PLUGIN_API } from '../../shared/constants.js';
import { PLUGIN_CLASSES, PLUGIN_MANIFEST, isPackPath, isSemver } from '../../shared/plugins/manifest.js';
import { atlasInfo } from '../../tools/assets/atlas.mjs';
import { errorWords } from '../plugins/pack.js';
import { appRangeNow, manifestText } from './templates/index.js';
import { StudioError } from './files.js';

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const okPath = (p) => Array.isArray(p) && p.length > 0 && p.length <= 12 && p.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 128 && !FORBIDDEN.has(k));

/** The value at a path of plain data (own properties), or undefined. @param {any} obj @param {string[]} p */
export function getIn(obj, p) {
  let node = obj;
  for (const k of p) { if (!isObj(node) || !Object.hasOwn(node, k)) return undefined; node = node[k]; }
  return node;
}

/** Set a value at a path, making the objects on the way. @param {any} obj @param {string[]} p @param {unknown} value */
export function setIn(obj, p, value) {
  if (!okPath(p)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'not a path' });
  let node = obj;
  for (const k of p.slice(0, -1)) { if (!isObj(node[k])) node[k] = {}; node = node[k]; }
  node[p[p.length - 1]] = value;
}

/**
 * Remove the value at a path; the objects it leaves empty go too, up to (not including) `keep` levels from the top.
 * @param {any} obj @param {string[]} p @param {number} [keep]
 */
export function deleteIn(obj, p, keep = 1) {
  if (!okPath(p)) return false;
  const chain = [obj];
  for (const k of p.slice(0, -1)) { const n = chain[chain.length - 1]; if (!isObj(n) || !Object.hasOwn(n, k)) return false; chain.push(n[k]); }
  const last = chain[chain.length - 1];
  if (!isObj(last) || !Object.hasOwn(last, p[p.length - 1])) return false;
  delete last[p[p.length - 1]];
  for (let i = chain.length - 1; i >= keep; i--) {
    if (Object.keys(chain[i]).length) break;
    delete chain[i - 1][p[i - 1]];
  }
  return true;
}

/**
 * A plugin's manifest and overlay to edit: `{ manifest, overlay, save() }` — overlay the `assets` object (inline, or the
 * parsed file it names; created inline when the plugin has none yet), save() writes what changed.
 * @param {ReturnType<typeof import('./files.js').createPluginFiles>} files @param {string} id
 */
export function openPlugin(files, id) {
  const dir = files.root(id);
  let manifest;
  // a plain file of the folder only (files.stat: never through a link put in its place)
  const file = files.stat(id, PLUGIN_MANIFEST);
  try { manifest = JSON.parse(fs.readFileSync(file.abs, 'utf8')); } catch (e) {
    throw new StudioError('PLUGIN_JSON', 409, { file: PLUGIN_MANIFEST, detail: errorWords(e) }, `${PLUGIN_MANIFEST} cannot be read`);
  }
  if (!isObj(manifest)) throw new StudioError('PLUGIN_MANIFEST_SHAPE', 409, {}, 'plugin.json is not an object');
  let overlayFile = null;
  let overlay;
  if (typeof manifest.assets === 'string' && isPackPath(manifest.assets)) {
    overlayFile = manifest.assets;
    try { overlay = JSON.parse(fs.readFileSync(files.resolve(id, overlayFile), 'utf8')); } catch { overlay = {}; }
    if (!isObj(overlay)) overlay = {};
  } else {
    if (!isObj(manifest.assets)) manifest.assets = {};
    overlay = manifest.assets;
  }
  const before = { manifest: JSON.stringify(manifest), overlay: overlayFile ? JSON.stringify(overlay) : null };
  return {
    dir, manifest, overlay, overlayFile,
    /** Write plugin.json (and the overlay's own file) when they changed. */
    save() {
      if (overlayFile && JSON.stringify(overlay) !== before.overlay) files.write(id, overlayFile, Buffer.from(manifestText(overlay)));
      if (JSON.stringify(manifest) !== before.manifest) files.write(id, PLUGIN_MANIFEST, Buffer.from(manifestText(manifest)));
    },
  };
}

/** The basic fields the studio's form edits, with what each accepts (an empty value removes the field). */
const META_FIELDS = Object.freeze({
  name: 'text', description: 'longtext', version: 'version', authors: 'list', license: 'line', credits: 'line', homepage: 'line', scope: 'scope',
});

/**
 * Edit the basic fields (see META_FIELDS): `{ field: value }` — a text in `lang` for name / description (other languages
 * kept), a list of names for authors, a list of scopes the class allows.
 * @param {ReturnType<typeof openPlugin>} p @param {Record<string, unknown>} fields @param {string} [lang]
 */
export function editMeta(p, fields, lang = 'zh') {
  const m = p.manifest;
  const code = /^[a-z]{2}(-[A-Z]{2})?$/.test(lang) ? lang : 'zh';
  for (const [k, v] of Object.entries(isObj(fields) ? fields : {})) {
    const kind = META_FIELDS[k];
    if (!kind) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: `${k} is not a field the studio edits` });
    // a value that is not a text (a list, an object) counts as none
    const str = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
    if (kind === 'text' || kind === 'longtext') {
      const text = str.trim().slice(0, kind === 'text' ? 60 : 500);
      const cur = isObj(m[k]) ? { ...m[k] } : typeof m[k] === 'string' && m[k] ? { [m.sourceLang || 'zh']: m[k] } : {};
      if (text) cur[code] = text; else delete cur[code];
      if (Object.keys(cur).length) m[k] = cur; else delete m[k];
    } else if (kind === 'version') {
      const s = str.trim();
      if (!isSemver(s)) throw new StudioError('PLUGIN_VERSION', 400, {}, `${s.slice(0, 40)} is not a version`);
      m.version = s;
    } else if (kind === 'list') {
      const list = (Array.isArray(v) ? v : str.split(/[,，、\n]/)).map((x) => (typeof x === 'string' ? x : '').trim().slice(0, 200)).filter(Boolean).slice(0, 32);
      if (list.length) m[k] = list; else delete m[k];
    } else if (kind === 'line') {
      const s = str.trim().slice(0, k === 'homepage' ? 300 : k === 'credits' ? 500 : 100);
      if (s) m[k] = s; else delete m[k];
    } else if (kind === 'scope') {
      const allowed = PLUGIN_CLASSES[m.class]?.scopes || [];
      const list = (Array.isArray(v) ? v : []).filter((x) => allowed.includes(x));
      if (!list.length) throw new StudioError('PLUGIN_SCOPE', 400, {}, 'no scope');
      m.scope = allowed.filter((x) => list.includes(x));
    }
  }
}

/** Is `at` a path into the overlay a slot may hold (2–8 plain keys)? @param {unknown} at */
const okAt = (at) => okPath(at) && at.length >= 2 && at.length <= 8;

/**
 * Set a slot of the overlay: `value` a path of the plugin folder, a list of them, a track `{ loop, intro? }`, a Spine
 * model `{ skel, atlas?, textures? }`, or `{ ref: key }` (the installation's art) — written as is; the registry checks it.
 * @param {ReturnType<typeof openPlugin>} p @param {string[]} at @param {unknown} value
 */
export function setSlot(p, at, value) {
  if (!okAt(at)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'not a slot' });
  setIn(p.overlay, at, value);
}

/**
 * Empty a slot of the overlay (its entry stays when other fields are written; a record of fields keeps its key).
 * @param {ReturnType<typeof openPlugin>} p @param {string[]} at
 */
export function clearSlot(p, at) {
  if (!okAt(at)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'not a slot' });
  deleteIn(p.overlay, at, Math.min(at.length - 1, 2));
}

/** The files a value of the overlay names (paths of the plugin folder). @param {unknown} v */
export function filesOfValue(v) {
  const out = [];
  const walk = (x) => {
    if (typeof x === 'string') { if (/\.[A-Za-z0-9]{2,6}$/.test(x)) out.push(x); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (isObj(x)) for (const [k, y] of Object.entries(x)) if (k !== 'ref') walk(y);
  };
  walk(v);
  return out;
}

/** Every file the overlay names. @param {any} overlay */
export const filesOfOverlay = (overlay) => new Set(filesOfValue(overlay));

/**
 * The atlas pages of a model's atlas file in the plugin folder (paths relative to the plugin: the atlas's folder + page).
 * @param {ReturnType<typeof import('./files.js').createPluginFiles>} files @param {string} id @param {string} atlasRel
 */
export function atlasPages(files, id, atlasRel) {
  const info = atlasInfo(fs.readFileSync(files.resolve(id, atlasRel), 'utf8'));
  const folder = atlasRel.replace(/[^/]*$/, '');
  return info.pages.map((pg) => folder + pg);
}

/**
 * The one-click fixes (shared/plugins/errors.js `autofix`) — each changes the plugin and returns what it did (a short
 * English note for the log). `pack` and `moveOut` are the API's (they touch files, not the manifest).
 * @type {Record<string, (p: ReturnType<typeof openPlugin>, issue: { at?: string[], file?: string, params?: any }, ctx: { files: any, id: string }) => string>}
 */
export const FIXES = {
  setManifest(p) { p.manifest.manifest = 2; return 'manifest 2'; },
  setVersion(p) { p.manifest.version = '1.0.0'; return 'version 1.0.0'; },
  setApp(p) { p.manifest.app = appRangeNow(); return `app ${p.manifest.app}`; },
  setApi(p) { p.manifest.api = PLUGIN_API.current; return `api ${PLUGIN_API.current}`; },
  setScope(p) { p.manifest.scope = [...(PLUGIN_CLASSES[p.manifest.class]?.defaultScope || ['room', 'personal'])]; return `scope ${p.manifest.scope.join(',')}`; },
  dropField(p, issue) {
    const k = issue.at?.[0];
    if (!k || ['manifest', 'class', 'assets'].includes(k)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'no field to remove' });
    delete p.manifest[k];
    return `removed "${k}"`;
  },
  addPermission(p, issue) {
    const need = String(issue.params?.need || '');
    if (!/^[a-z.]+$/.test(need)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'no permission named' });
    const list = Array.isArray(p.manifest.permissions) ? p.manifest.permissions.filter((x) => typeof x === 'string') : [];
    if (!list.includes(need)) list.push(need);
    p.manifest.permissions = list;
    return `added permission ${need}`;
  },
  dropPermission(p, issue, { files, id }) {
    const perm = String(issue.params?.permission || '');
    const plugin = readPluginFolder(files.root(id)).plugin;
    if (plugin && operatorTraitPermissions(plugin.content, plugin.manifest).has(perm)) {
      throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'permission is used by record kits or traits' });
    }
    if (Array.isArray(p.manifest.permissions)) p.manifest.permissions = p.manifest.permissions.filter((x) => x !== perm);
    if (Array.isArray(p.manifest.permissions) && !p.manifest.permissions.length) delete p.manifest.permissions;
    return `removed permission ${perm}`;
  },
  dropAsset(p, issue) {
    const at = issue.at?.[0] === 'assets' ? issue.at.slice(1) : null;
    if (!at || !at.length || !deleteIn(p.overlay, at, Math.min(at.length - 1, 2))) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'no write to remove' });
    return `removed assets.${at.join('.')}`;
  },
  setTextures(p, issue, { files, id }) {
    const atlas = String(issue.file || '');
    const pages = atlasPages(files, id, atlas);
    let n = 0;
    const walk = (node) => {
      if (!isObj(node)) return;
      if (typeof node.skel === 'string') {
        const a = typeof node.atlas === 'string' ? node.atlas : node.skel.replace(/\.skel$/, '.atlas');
        if (a === atlas) { node.textures = pages; n++; }
        return;
      }
      for (const v of Object.values(node)) walk(v);
    };
    walk(p.overlay);
    if (!n) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: `no model with the atlas ${atlas}` });
    return `textures of ${atlas}: ${pages.join(', ')}`;
  },
};
