// server/studio/files.js — the studio's file system (DESIGN §32.9, docs/PLUGINS.md §15): every read and write the studio's
// API makes stays inside one plugin folder, plugins/<id>/.
//
//   * the id is a plugin id (shared/plugins/manifest.js isPluginId: lower case, digits, '-'; never '_' templates, never
//     '.', never a path) and the folder plugins/<id>/ a real folder — one that is itself a symbolic link is never a root
//     of the studio (PLUGIN_STUDIO_PATH, 403, for every read and write: an archive unpacked into plugins/ can bring a
//     link to anywhere; the game's registry may still load it — it serves only the files its overlay names); the
//     plugins folder itself may be a link (the owner's choice: plugins kept on another disk);
//   * a path inside it is a plain relative path (isPackPath: letters, digits, '. _ -', spaces; no '..', no '.' part, no
//     hidden part, at most 200 characters) of a file type a plugin may carry (WRITABLE: art, models, audio, fonts, .json,
//     documents) — never plugin.lock.json (only the packer writes it) by hand;
//   * no link inside the folder is followed: every folder on the way and the file itself are lstat'ed, a link refuses
//     the path (PLUGIN_STUDIO_PATH), and the real path must still be under the plugin's root afterwards;
//   * sizes: a file at most STUDIO_LIMITS.fileBytes (64 MB), a plugin.json at most 1 MB, a plugin in all at most
//     PLUGIN_LIMITS.pluginBytes (200 MB) and PLUGIN_LIMITS.files files [ASSUMED: 64 MB and 1 MB];
//   * a write goes to a dot-named temporary file in the target's folder, then is renamed over it (a reader — the registry,
//     a page — sees the old file or the new one, never half of one; dot files are never listed or served);
//   * the studio's own dot file of a folder (SIDECARS: `.studio.json`, server/studio/index.js) is read only when it is a
//     plain file and written the same way (renamed over: a link in its place is replaced, never written through);
//   * a file moved out of a plugin (moveOut, the one-click fix of a file type the plugin may not carry) goes to
//     plugins/_moved/<id>/<path> — every folder on the way a plain folder, never a link — and is never deleted.
// Errors are thrown as `StudioError { code, status, params }` (code: shared/plugins/errors.js).

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isPluginId, isPackPath, extOf, ASSET_EXT, PLUGIN_LIMITS, PLUGIN_MANIFEST } from '../../shared/plugins/manifest.js';
import { LOCK_FILE } from '../../shared/plugins/visual.js';
import { listPluginFiles } from '../plugins/registry.js';

/** [ASSUMED] the studio's own limits: one file, a manifest, a request body (a model's files in one go, base64). */
export const STUDIO_LIMITS = Object.freeze({ fileBytes: 64 * 1024 * 1024, manifestBytes: 1024 * 1024, bodyBytes: 160 * 1024 * 1024 });

/** The studio's own dot files of a plugin folder (never listed, served, checked or packed). */
export const SIDECARS = Object.freeze(['.studio.json']);

/** File types the studio writes into a plugin folder: art, models, audio, fonts, data, documents. */
export const WRITABLE = Object.freeze([...ASSET_EXT, '.json', '.md', '.txt']);

/** An error of the studio's API: a catalogue code, an HTTP status, the explanation's params. */
export class StudioError extends Error {
  /** @param {string} code @param {number} status @param {Record<string, unknown>} [params] @param {string} [message] */
  constructor(code, status, params = {}, message = '') {
    super(message || code);
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

const bad = (detail, status = 400) => new StudioError('PLUGIN_STUDIO_PATH', status, { detail }, detail);

/**
 * The plugin folders of a plugins/ directory, confined (see the header).
 * @param {string} pluginsDir
 */
export function createPluginFiles(pluginsDir) {
  const base = path.resolve(pluginsDir);

  /** The plugins folder's real path (created when missing: the first plugin of a server). */
  function realBase(create = false) {
    if (create) fs.mkdirSync(base, { recursive: true });
    return fs.realpathSync.native(base);
  }

  /**
   * The root of a plugin (its real path) — it must exist (`create`: make it; it must not exist then).
   * @param {string} id @param {{ create?: boolean }} [opts]
   */
  function root(id, { create = false } = {}) {
    if (!isPluginId(id)) throw new StudioError('PLUGIN_ID', 400, { id: String(id).slice(0, 40) }, `${String(id).slice(0, 40)} is not a plugin id`);
    const top = realBase(create);
    const dir = path.join(top, id);
    let st;
    try { st = fs.lstatSync(dir); } catch { st = null; }
    if (create) {
      if (st) throw new StudioError('PLUGIN_STUDIO_EXISTS', 409, { id }, `${id} exists`);
      // another case of the same name on a case-insensitive disk is the same folder (the registry's rule)
      const clash = fs.readdirSync(top).find((n) => n.toLowerCase() === id.toLowerCase());
      if (clash) throw new StudioError('PLUGIN_STUDIO_EXISTS', 409, { id: clash }, `${clash} exists`);
      fs.mkdirSync(dir);
      return fs.realpathSync.native(dir);
    }
    if (!st) throw new StudioError('PLUGIN_UNKNOWN', 404, { id }, `${id} is not a plugin folder`);
    // never through a link: neither read nor written, listed, previewed, zipped or packed (see the header)
    if (st.isSymbolicLink()) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: `plugins/${id} is a symbolic link` }, `plugins/${id} is a symbolic link`);
    if (!st.isDirectory()) throw new StudioError('PLUGIN_UNKNOWN', 404, { id }, `${id} is not a plugin folder`);
    // its real path (the disk's spelling of the name) — still a folder right inside the plugins folder
    const real = fs.realpathSync.native(dir);
    if (path.dirname(real) !== top) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: `plugins/${id} is a symbolic link` }, `plugins/${id} leads out of the plugins folder`);
    return real;
  }

  /**
   * The absolute path of `rel` inside the plugin `id`, every step checked (see the header): no link on the way, inside the
   * root. `forWrite`: the folders on the way may be missing (they are made by write()).
   * @param {string} id @param {string} rel @param {{ forWrite?: boolean }} [opts]
   */
  function resolve(id, rel, { forWrite = false } = {}) {
    if (!isPackPath(rel)) throw bad(`${String(rel).slice(0, 80)} is not a plain path inside the plugin folder`);
    const top = root(id);
    const parts = rel.split('/');
    let cur = top;
    for (let i = 0; i < parts.length; i++) {
      cur = path.join(cur, parts[i]);
      let st;
      try { st = fs.lstatSync(cur); } catch {
        if (forWrite) return path.join(top, ...parts);
        throw new StudioError('PLUGIN_FILE_MISSING', 404, { file: rel }, `${rel} is missing`);
      }
      if (st.isSymbolicLink()) throw bad(`${parts.slice(0, i + 1).join('/')} is a symbolic link`, 403);
      if (i < parts.length - 1 && !st.isDirectory()) throw bad(`${parts.slice(0, i + 1).join('/')} is not a folder`);
    }
    const real = fs.realpathSync.native(cur);
    if (real !== top && !real.startsWith(top + path.sep)) throw bad(`${rel} leads out of the plugin folder`, 403);
    return real;
  }

  /** Is `rel` a file type the studio writes (see the header)? @param {string} rel */
  const writable = (rel) => WRITABLE.includes(extOf(rel)) && rel !== LOCK_FILE;

  /**
   * Read a file of a plugin (a regular file, no link) → { abs, st }.
   * @param {string} id @param {string} rel
   */
  function stat(id, rel) {
    const abs = resolve(id, rel);
    const st = fs.lstatSync(abs);
    if (!st.isFile()) throw new StudioError('PLUGIN_FILE_MISSING', 404, { file: rel }, `${rel} is not a file`);
    return { abs, st };
  }

  /**
   * Write a file of a plugin (see the header): the size limits, the type, the folder's totals, then a temporary file
   * renamed over the target.
   * @param {string} id @param {string} rel @param {Buffer} data
   */
  function write(id, rel, data, { generated = false, aggregate = true } = {}) {
    // Internal staged saves may publish the packer's verified lock; raw API writes still cannot.
    if (!writable(rel) && !(generated && (rel === LOCK_FILE || ['.js', '.html', '.css'].includes(extOf(rel))))) throw new StudioError('PLUGIN_FILE_TYPE', 400, { file: rel, ext: extOf(rel) || '-', class: 'cosmetic' }, `${rel}: not a file type the studio writes`);
    const limit = rel === PLUGIN_MANIFEST ? STUDIO_LIMITS.manifestBytes : extOf(rel) === '.json' ? PLUGIN_LIMITS.jsonBytes : STUDIO_LIMITS.fileBytes;
    if (data.length > limit) throw new StudioError('PLUGIN_STUDIO_SIZE', 413, { max: `${Math.round(limit / 1048576)} MB`, file: rel }, `${rel}: larger than ${limit} bytes`);
    const top = root(id);
    const abs = resolve(id, rel, { forWrite: true });
    // the folder's totals with this file in place of its old self
    if (aggregate) {
      const files = listPluginFiles(top);
      if (files.truncated) throw new StudioError('PLUGIN_FILE_SIZE', 413, { where: 'a folder over the walk limits' }, 'the plugin folder is over its walk limits');
      const old = files.find((f) => f.rel === rel);
      const bytes = files.reduce((n, f) => n + f.bytes, 0) - (old ? old.bytes : 0) + data.length;
      if (bytes > PLUGIN_LIMITS.pluginBytes) throw new StudioError('PLUGIN_STUDIO_SIZE', 413, { max: `${PLUGIN_LIMITS.pluginBytes / 1048576} MB` }, 'the plugin would be over its size limit');
      if (!old && files.length + 1 > PLUGIN_LIMITS.files) throw new StudioError('PLUGIN_FILE_SIZE', 413, { where: `${files.length + 1} files` }, 'too many files');
    }
    // the folders on the way, made and each checked again (a link swapped in meanwhile is refused)
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    let cur = top;
    for (const part of path.relative(top, dir).split(path.sep).filter(Boolean)) {
      cur = path.join(cur, part);
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink() || !st.isDirectory()) throw bad(`${path.relative(top, cur).split(path.sep).join('/')} is not a plain folder`, 403);
    }
    const realDir = fs.realpathSync.native(dir);
    if (realDir !== top && !realDir.startsWith(top + path.sep)) throw bad(`${rel} leads out of the plugin folder`, 403);
    const tmp = path.join(dir, `.studio-${randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, data, { flag: 'wx' });
    try {
      const st = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (st && !st.isFile()) throw bad(`${rel} is not a file`);
      fs.renameSync(tmp, abs);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* gone */ }
      throw e;
    }
    return abs;
  }

  /**
   * The text of one of the studio's own dot files (SIDECARS) of a plugin, or null when it is missing or not a plain file.
   * @param {string} id @param {string} name
   */
  function readSidecar(id, name) {
    if (!SIDECARS.includes(name)) throw bad(`${String(name).slice(0, 40)} is not a file of the studio`);
    const abs = path.join(root(id), name);
    const st = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.size > PLUGIN_LIMITS.jsonBytes) return null;
    return fs.readFileSync(abs, 'utf8');
  }

  /**
   * Write one of the studio's own dot files (SIDECARS) of a plugin: a temporary file renamed over it (a link in its place
   * is replaced, never followed).
   * @param {string} id @param {string} name @param {Buffer} data
   */
  function writeSidecar(id, name, data) {
    if (!SIDECARS.includes(name)) throw bad(`${String(name).slice(0, 40)} is not a file of the studio`);
    if (data.length > PLUGIN_LIMITS.jsonBytes) throw new StudioError('PLUGIN_STUDIO_SIZE', 413, { max: `${Math.round(PLUGIN_LIMITS.jsonBytes / 1048576)} MB`, file: name });
    const top = root(id);
    const abs = path.join(top, name);
    const tmp = path.join(top, `.studio-${randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, data, { flag: 'wx' });
    try {
      const st = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (st && !st.isFile() && !st.isSymbolicLink()) throw bad(`${name} is not a file`);
      fs.renameSync(tmp, abs);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* gone */ }
      throw e;
    }
  }

  /**
   * Move a file out of a plugin (see the header) → its path relative to the plugins folder (`_moved/<id>/<path>`, a
   * number added when that name is taken).
   * @param {string} id @param {string} rel
   */
  function moveOut(id, rel) {
    const { abs } = stat(id, rel);
    const top = realBase();
    let cur = top;
    for (const part of ['_moved', id, ...rel.split('/').slice(0, -1)]) {
      cur = path.join(cur, part);
      let st = fs.lstatSync(cur, { throwIfNoEntry: false });
      if (!st) { fs.mkdirSync(cur); st = fs.lstatSync(cur); }
      if (st.isSymbolicLink() || !st.isDirectory()) throw bad(`${path.relative(top, cur).split(path.sep).join('/')} is not a plain folder`, 403);
    }
    const name = rel.split('/').pop();
    let dest = path.join(cur, name);
    for (let n = 2; fs.lstatSync(dest, { throwIfNoEntry: false }); n++) {
      if (n > 999) throw bad(`${rel}: too many moved copies`, 409);
      dest = path.join(cur, `${name}.${n}`);
    }
    fs.renameSync(abs, dest);
    return path.relative(top, dest).split(path.sep).join('/');
  }

  /**
   * Remove a file of a plugin (a regular file; never plugin.json), and the folders it leaves empty.
   * @param {string} id @param {string} rel
   */
  function remove(id, rel) {
    if (rel === PLUGIN_MANIFEST) throw bad('plugin.json is never removed by the studio');
    const { abs } = stat(id, rel);
    fs.unlinkSync(abs);
    const top = root(id);
    for (let dir = path.dirname(abs); dir !== top && dir.startsWith(top + path.sep); dir = path.dirname(dir)) {
      try { fs.rmdirSync(dir); } catch { break; }
    }
  }

  /** The ids of the plugins folder's entries with a plugin id (not '_' templates, not dot folders), sorted, by kind. */
  function entries() {
    let names;
    let top;
    try { top = realBase(); names = fs.readdirSync(top); } catch { return { dirs: [], links: [] }; }
    const dirs = [];
    const links = [];
    for (const n of names.filter((x) => isPluginId(x)).sort()) {
      let st;
      try { st = fs.lstatSync(path.join(top, n)); } catch { continue; }
      if (st.isSymbolicLink()) links.push(n);
      else if (st.isDirectory()) dirs.push(n);
    }
    return { dirs, links };
  }
  /** The plugin folders the studio opens (real folders), sorted. */
  const ids = () => entries().dirs;
  /** The plugin folders that are symbolic links (listed, never opened: root), sorted. */
  const links = () => entries().links;

  return { base, root, resolve, stat, write, remove, ids, links, writable, readSidecar, writeSidecar, moveOut, list: (id) => listPluginFiles(root(id)) };
}
