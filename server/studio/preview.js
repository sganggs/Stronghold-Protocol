import { readFxManifest as readPluginManifest } from '../plugins/fxAssets.js';
// server/studio/preview.js — the studio's temporary composition of a plugin as it is now (DESIGN §32.9, docs/PLUGINS.md
// §15; GET /studio/api/plugins/<id>/preview): what the plugin's overlay writes, ready to be laid over the page's own art
// manifest — also while the plugin still has problems (the registry keeps such a plugin out; the studio shows what it can)
// and before it is packed (a Spine model's clip data is read from the skeleton itself when the lock lacks it or is stale:
// server/plugins/pack.js skeletonClipData, kept by the skeleton's and the atlas's SHA-256).
//
//   { ops: [{ at, value } | { at, from } | { at, clear: true }], issues }
//   at     the path in data/assets.json (['chars', 'char_102_texas', 'avatar'])
//   value  what the manifest holds there: a URL of the plugin's file (GET /studio/api/plugins/<id>/f/<hash8>/<path>, the
//          8 hex digits of its SHA-256 — of its model's files' SHA-256s for every file of a Spine model, so the skeleton,
//          its atlas and pages share one folder as pixi-spine needs, like /p/), a list of them, a track { loop, intro? },
//          a line of the manifest as it is (a skin's `name` or `group`, shared/plugins/visual.js 'text'), a
//          Spine entry { skel, atlas, textures, pma, anims, animations, events, hits, bounds }
//   from   a reference: the path of the installation's entry the page copies out of its own manifest
//   clear  an enemy's or a token's local-client model taken away with its new model (shared/plugins/visual.js)
// Nothing here is served to the game: the game only ever draws a loaded plugin through /vs/ and /p/ (P1a).

import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_MANIFEST } from '../../shared/plugins/manifest.js';
import { LOCK_FILE, readPluginLock, modelHashOf, FILE_URL_DIGITS } from '../../shared/plugins/visual.js';
import { issueList } from '../../shared/plugins/errors.js';
import { hashFile, listPluginFiles } from '../plugins/registry.js';
import { errorWords, plainPath, readOverlayOf, skeletonClipData } from '../plugins/pack.js';

/** The URL prefix of a plugin's files in the studio. */
export const STUDIO_FILES = '/studio/api/plugins/';

/** The studio URL of a plugin file: /studio/api/plugins/<id>/f/<hash8>/<path>, every segment URL-encoded. */
export const studioFileUrl = (id, hash8, rel) => `${STUDIO_FILES}${id}/f/${hash8}/${String(rel).split('/').map(encodeURIComponent).join('/')}`;

/**
 * The preview composer of one server (it keeps file hashes and parsed clip data between calls).
 * @param {{ vanilla: () => import('../plugins/registry.js').VanillaAssets }} opts vanilla: the installation's art manifest
 */
export function createPreviews({ vanilla }) {
  /** @type {import('../plugins/registry.js').HashCache} */
  const hashes = new Map();
  /** @type {Map<string, ReturnType<typeof skeletonClipData>>} `${skel sha}|${atlas sha}|${containers}` → the model's clip data */
  const clips = new Map();

  /**
   * The composition of the plugin folder `dir` (see the header).
   * @param {string} id @param {string} dir the plugin's real folder
   */
  function preview(id, dir) {
    const list = issueList();
    let raw;
    // never through a link put in the folder (plainPath): what the page gets is the plugin's own
    try { raw = JSON.parse(fs.readFileSync(plainPath(dir, PLUGIN_MANIFEST), 'utf8')); } catch (e) {
      if (e?.code === 'ELINK') list.problem('PLUGIN_FILE_LINK', e.message, { file: PLUGIN_MANIFEST });
      else list.problem('PLUGIN_JSON', `${PLUGIN_MANIFEST}: ${errorWords(e)}`, { file: PLUGIN_MANIFEST, detail: errorWords(e) });
      return { ops: [], issues: list.issues };
    }
    const read = readPluginManifest(raw, { id });
    const manifest = read.manifest || read.draft;
    if (!manifest || !manifest.parts.assets) return { ops: [], issues: [] };
    const present = new Set(listPluginFiles(dir).filter((f) => !f.link).map((f) => f.rel));
    const ov = readOverlayOf(dir, manifest, { vanilla: vanilla(), has: (rel) => present.has(rel) });
    if (!ov) return { ops: [], issues: [] };
    const sha = (rel) => hashFile(path.join(dir, ...rel.split('/')), hashes)?.sha256 ?? null;
    const url = (rel, hash = null) => { const h = hash || sha(rel); return h ? studioFileUrl(id, h.slice(0, FILE_URL_DIGITS), rel) : null; };
    // the lock's clip data where it was made from the skeleton the folder holds now
    let lock = null;
    if (present.has(LOCK_FILE)) {
      try { lock = readPluginLock(JSON.parse(fs.readFileSync(plainPath(dir, LOCK_FILE), 'utf8'))).lock; } catch { lock = null; }
    }
    /** @type {Map<string, Set<string>>} */
    const users = new Map();
    for (const op of ov.ops) if (op.spine) { if (!users.has(op.spine.skel)) users.set(op.spine.skel, new Set()); users.get(op.spine.skel).add(op.at[0]); }
    const ops = [];
    for (const op of ov.ops) {
      if (op.effects) {
        const images = Object.fromEntries(Object.entries(op.effects.images).map(([rel, size]) => [rel, { ...size, url: url(rel) }]));
        ops.push({ at: op.at, value: { ...op.effects, id, images } }); continue;
      }
      if (op.ref !== undefined) { ops.push({ at: op.at, from: op.from }); continue; }
      if (op.clear) { ops.push({ at: op.at, clear: true }); continue; }
      if (op.file !== undefined) { const u = url(op.file); if (u) ops.push({ at: op.at, value: u }); continue; }
      if (op.files !== undefined) { const us = op.files.map((f) => url(f)); if (us.every(Boolean)) ops.push({ at: op.at, value: us }); continue; }
      if (op.text !== undefined) { ops.push({ at: op.at, value: op.text }); continue; }
      if (op.track !== undefined) {
        const loop = url(op.track.loop);
        const intro = op.track.intro !== undefined ? url(op.track.intro) : null;
        if (loop && (op.track.intro === undefined || intro)) ops.push({ at: op.at, value: intro ? { intro, loop } : { loop } });
        continue;
      }
      if (op.spine) {
        const s = op.spine;
        const model = [s.skel, s.atlas, ...s.textures];
        const shas = model.map(sha);
        if (!shas.every(Boolean)) continue;
        const m = modelHashOf(shas);
        const users0 = users.get(s.skel) || new Set();
        let meta = lock?.spine?.[s.skel] && lock.spine[s.skel].sha256 === shas[0] ? lock.spine[s.skel] : null;
        if (!meta) {
          const key = `${shas[0]}|${shas[1]}|${[...users0].sort().join(',')}`;
          if (!clips.has(key)) {
            clips.set(key, skeletonClipData(dir, s, users0));
            while (clips.size > 64) clips.delete(clips.keys().next().value);
          }
          const c = clips.get(key);
          list.take(c);
          meta = c.entry;
        }
        if (!meta) continue;
        ops.push({ at: op.at, value: {
          skel: url(s.skel, m), atlas: url(s.atlas, m), textures: s.textures.map((t) => url(t, m)), pma: s.pma,
          anims: meta.anims, animations: meta.animations, events: meta.events, hits: meta.hits, bounds: meta.bounds,
        } });
      }
    }
    return { ops, issues: list.issues };
  }
  return { preview };
}
