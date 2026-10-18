// shared/plugins/visual.js — the cosmetic plugins (DESIGN §32 P1a, docs/PLUGINS.md §9): the asset overlay a cosmetic
// plugin carries — its `assets` part, written in the shape of data/assets.json (docs/ASSETS.md "Manifest schema") with
// the plugin's own files and references to the installation's entries — read and checked (readAssetOverlay), merged in
// load order with a warning where two plugins change the same thing (mergePluginOps); the visual hash `vs` that names a
// set of them (visualHashOf); the document a set is served as and the check a browser runs on it (checkVisualDoc); and
// what the browser makes of it (prepareVisualDoc, layVisualOps): the art it draws, composed on its own manifest. No Node
// builtin: the server reads and checks with it (server/plugins/registry.js) and serves the sets
// (server/plugins/visualSet.js), the browser composes with it (public/js/assets.js cosmetic layers), the tools check and
// pack with it (tools/plugin.mjs).
//
// The overlay (`assets`, inline in plugin.json or a .json file of the plugin) — the record containers of data/assets.json
// a plugin may write (ASSET_CONTAINERS), each record in the manifest's own shape:
//   chars[charId]            { avatar, avatarE2, portrait, portraitE2, illust: image, spine: { front, back: Spine },
//                              skins: { <skin id>: { name, group: text, avatar, avatarE2, portrait, portraitE2, illust:
//                              image, spine: { front, back: Spine } } } }
//   enemies[key]             { icon: image, spine: Spine }          tokens[id]  { avatar: image, spine: Spine }
//   bonds / items / bands / skills / modules / ui[key], prof.icon / large / battlecard / sub[key]     image
//   audio.bgm[lobby|prep|combat|unite|boss], audio.bossBgm[bossId]     a track { loop, intro? }: replaced as a whole
//   audio.voice / voiceJp / voiceEn / voiceKr / voiceNative[charId]  { <slot>: audio or a list of 1–16 }      audio.sfx.ui / battle[key]  audio
//   audio.sfx.units[id]      { attack, hit, skill, die, born: audio, skills / attacks / hits: { <index>: audio } }
// A skin's key (under `chars[charId].skins`) is the installation's own skin id — where its manifest has one, e.g.
// char_003_kalts@boc#6, else a name the plugin introduces (whatever wears a skin and the plugin have to agree on that
// key) — wider than an entry key by '@' '#' '+', narrower by '/', and at most 64 characters where an entry key takes 128,
// never a name of Object.prototype; a key shaped like an entry key (the stem form
// char_102_texas_epoque_7) is taken too, for an installation that has no skin id for it [ASSUMED]. One operator's record
// takes at most 64 skins; `name` is a text of 1–64 characters (the skin's name) and `group` one of 0–64 (its series, as
// that file writes them — an outfit the plugin itself adds may have no series; every operator skin of the official table
// has one, so this is room for a plugin's own entry, not the state of the manifest), the rest of a skin's record the
// operator's own kinds and fields. A reference from a skin is resolved against the entry's own skin of the same key, so
// it means something only once the installation's manifest carries `skins` itself (the committed data/assets.json of this
// version has none); until then only the operator's own record can be referenced.
// A value is a path inside the plugin folder (an image .png .jpg .webp, audio .mp3 .ogg), a Spine object
// `{ skel, atlas, textures?, pma? }` (.skel and .atlas side by side with one name — pixi-spine finds the atlas next to the
// skeleton —, the pages inside the atlas's folder, default `<name>.png`; its clip roles, durations, events, hits and
// bounds come from plugin.lock.json — tools/plugin.mjs pack — never by hand: `"anims": "auto"` or nothing), or a
// reference `{ "ref": "<key>" }` to the entry of the same container in the installation's manifest: a whole record
// (`chars.char_102_texas = { "ref": "char_112_siege" }` — that record, replaced as a whole; other keys beside the ref
// then change fields of it) or one field (`chars.char_102_texas.avatar = { "ref": "char_112_siege" }` — that field of
// char_112_siege). A reference always names the installation's own entry, never another plugin's: the order of the
// plugins never changes what it means [ASSUMED]. A missing entry is a problem. Anything else — another top-level
// section (fonts, skillsById …), a field the record has not — is a warning and is left out; numbers, booleans and free
// text are never written into the manifest. A field a plugin does not write keeps the installation's value (an `avatar`
// alone leaves `avatarE2`), but a track is written whole (a `loop` alone plays without the installation's intro), and a
// model written for an enemy or a token (its `spine`, a model or a reference) also takes away the entry's local-client
// model `spineLocal` — the client would draw that one first (public/js/assets.js spineEntry) [ASSUMED].
//
// The ops: the overlay as a list of writes `{ at: [path…], … }` in the order the plugin wrote them — a plugin file
// (`file` / `files`), a BGM track (`track`), a Spine model (`spine`, with its clip data from the lock: `meta`), a line of
// the manifest (`text`: a skin's name or series), a reference (`ref`, `from`: the path it reads), an implied clear
// (`clear`: an enemy's or a token's `spineLocal`). They name paths of the plugin folder, never a URL.
//
//   vs = sha256(canonical({ v: 2, assets: <SHA-256 of data/assets.json>, overlays: [{ id, version, files, writes }] }))
//   files: { <path>: SHA-256 } — every file that shapes the plugin's overlay: plugin.json, plugin.lock.json, the
//   `assets` file and every file the overlay serves [ASSUMED] — so a changed byte in any of them changes `vs`;
//   writes: the SHA-256 of the canonical JSON of the plugin's ops as the server serves them (writesHashOf: the slots they
//   write, the files of the plugin they name, its references, a Spine model's clip data — never a URL), so `vs` pins
//   which file goes to which slot, not only which files there are.
//
// The document of a set (/vs/<vs16>/overlay.json, server/plugins/visualSet.js): `{ visual: { v, vs, assets, overlays },
// writes: [{ id, ops }] }` — its composition and each plugin's ops. A browser checks that the composition hashes to the
// `vs` it was told and that each plugin's ops hash to the `writes` of its composition (checkVisualDoc: a document that
// fails is refused as a whole — the room keeps the installation's art), and then composes the art itself, on the
// manifest it already loaded (its own
// /data/assets.json: 0.2.6's /assets/~<hash>/ URLs) — it never adopts a manifest the server put together, so what it
// draws is exactly what `vs` names (and the document stays small: no copy of the manifest):
//   * prepareVisualDoc: every plugin URL is built from the composition's file table — /p/<id>/<8 hex>/<path>
//     (PLUGIN_FILES_URL; the first 8 hex digits of the file's SHA-256 there, or for every file of a Spine model of its
//     files' SHA-256s — modelHashOf —, so the skeleton, the atlas and the pages share one folder, as pixi-spine needs);
//     an op naming a file the table lacks or of another kind than its field takes (an image as a sound, a page outside
//     its atlas's folder …), a path outside the containers or a clip data out of the lock's shape is dropped — never a
//     URL from anywhere else (no http(s):, no data:, no other path of the server);
//   * layVisualOps: a reference is copied out of that manifest itself (an entry it lacks: dropped), the writes laid over
//     it in load order (applyOps: the objects on the way copied, never changed in place).
// A dropped write leaves the art beneath it (the installation's) and the page says so once (public/js/content.js).
// Cosmetics never change a battle.

import { sha256Hex } from '../sha256.js';
import { canonicalJson, isContentHash } from './identity.js';
import { isPackPath, extOf, PLUGIN_IMAGE_EXTS, PLUGIN_AUDIO_EXTS } from './manifest.js';
import { issueList } from './errors.js';

/** The version of the `vs` composition above (a change of it changes every `vs`; 2: the `writes` of each overlay). */
export const VISUAL_HASH_VERSION = 2;
/** Hex digits of `vs` in a URL (/vs/<16 hex>/assets.json). */
export const VS_URL_DIGITS = 16;
/** Hex digits of a file's (or a Spine model's) hash in its URL (/p/<id>/<8 hex>/<path>). */
export const FILE_URL_DIGITS = 8;
/** Where a cosmetic plugin's files are served (server/http/static.js). */
export const PLUGIN_FILES_URL = '/p/';
/** Where visual sets are served: /vs/<vs16>/overlay.json (the set's composition and its plugins' writes). */
export const VISUAL_SETS_URL = '/vs/';
/** The name of a set's document under VISUAL_SETS_URL/<vs16>/. */
export const VISUAL_DOC_FILE = 'overlay.json';
/** The lock file tools/plugin.mjs pack writes next to plugin.json. */
export const LOCK_FILE = 'plugin.lock.json';
/** The version of plugin.lock.json. */
export const LOCK_VERSION = 1;
/**
 * [ASSUMED] limits: writes per plugin, files of one voice slot, the art a set may serve in all (the design study's 300 MB
 * per room), the override warnings one set reports, and what references may copy out of the installation's manifest —
 * per plugin and per set (as JSON text: a whole-record reference copies a record, so a few thousand of them would make a
 * room's effective manifest tens of MB without a byte of art).
 */
export const VISUAL_LIMITS = Object.freeze({
  ops: 20000, listFiles: 16, setBytes: 300 * 1024 * 1024, warnings: 32, copyBytes: 2 * 1024 * 1024, setCopyBytes: 4 * 1024 * 1024,
});
/**
 * [ASSUMED] limits of the clip data plugin.lock.json gives a Spine model (what tools/assets/skel.mjs and anim-roles.mjs
 * produce, with room to spare): animations per skeleton, the length of a clip or event name, a clip's duration (s),
 * events per skeleton, hit times per clip, numbered skill clips, the size of the skeleton's bounds.
 */
export const LOCK_LIMITS = Object.freeze({ animations: 256, name: 64, duration: 600, events: 64, hits: 64, skills: 10, bounds: 1e6 });

/** A full visual hash: 64 lowercase hex digits (the form of `cs`). */
export const isVisualHash = isContentHash;
/** The URL form of `vs`: its first VS_URL_DIGITS digits. @param {string} vs */
export const vsUrlPart = (vs) => String(vs).slice(0, VS_URL_DIGITS);

const IMAGE = PLUGIN_IMAGE_EXTS;
const AUDIO = PLUGIN_AUDIO_EXTS;
/** The image and audio files a cosmetic plugin's overlay names (defined in ./manifest.js). */
export { PLUGIN_IMAGE_EXTS, PLUGIN_AUDIO_EXTS };
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const short = (v) => { try { return String(JSON.stringify(v)).slice(0, 40); } catch { return typeof v; } };

/**
 * A field's kind: 'image' | 'audio' | 'audioList' (one audio file or a list) | 'track' (a BGM `{ loop, intro? }`, written
 * whole) | 'spine' | 'text' (a line of the manifest, 0–TEXT_MAX characters — 1 at least for a `name`, a skin's series
 * may be empty —, written as it is) — or an object of named
 * fields `{ fields }`, or one whose keys are free `{ each, key, max? }` (a voice slot, a skill index, an operator's
 * skins; `max` the most keys it takes).
 * @typedef {'image' | 'audio' | 'audioList' | 'track' | 'spine' | 'text' | { fields: Record<string, any> } | { each: any, key: RegExp, max?: number }} AssetKind
 * @typedef {{ path: string[], record: AssetKind, keys?: string[] }} AssetContainer
 */

const SLOT = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const INDEX = /^\d{1,2}$/;
/**
 * A skin key (see the header): the installation's own skin id, wider than an entry key by '@' '#' '+' '.', at most 64
 * characters. The length is part of this one pattern (and of `$defs.skinKey`): the reader tests it with `test` alone —
 * in readFields and in locateAssetPath —, so a limit written beside the call would be the one place that forgets it.
 */
const SKIN_KEY = /^[A-Za-z0-9_][A-Za-z0-9_@#+.-]{0,63}$/;
/** The longest text a plugin writes into the manifest (a skin's name or its series). */
const TEXT_MAX = 64;
/** The most skins one operator's record takes (the overlay schema's maxProperties). */
const SKINS_MAX = 64;
/** One skin of an operator: the pictures and models the operator's own record has, under its key, and its name. */
const SKIN_RECORD = { fields: { name: 'text', group: 'text', avatar: 'image', avatarE2: 'image', portrait: 'image',
  portraitE2: 'image', illust: 'image', spine: { fields: { front: 'spine', back: 'spine' } } } };
const SFX_UNIT = { fields: { attack: 'audio', hit: 'audio', skill: 'audio', die: 'audio', born: 'audio',
  skills: { each: 'audio', key: INDEX }, attacks: { each: 'audio', key: INDEX }, hits: { each: 'audio', key: INDEX } } };

/** @type {readonly AssetContainer[]} the record containers a cosmetic plugin writes (see the header) */
export const ASSET_CONTAINERS = Object.freeze(/** @type {AssetContainer[]} */ ([
  { path: ['chars'], record: { fields: { avatar: 'image', avatarE2: 'image', portrait: 'image', portraitE2: 'image', illust: 'image',
      spine: { fields: { front: 'spine', back: 'spine' } }, skins: { each: SKIN_RECORD, key: SKIN_KEY, max: SKINS_MAX, keyName: 'key (letters, digits, _ @ # + . -, at most 64 characters)', keyProblem: true } } } },
  { path: ['enemies'], record: { fields: { icon: 'image', spine: 'spine' } } },
  { path: ['tokens'], record: { fields: { avatar: 'image', spine: 'spine' } } },
  ...['bonds', 'items', 'bands', 'skills', 'modules', 'ui'].map((k) => ({ path: [k], record: 'image' })),
  ...['icon', 'large', 'battlecard', 'sub'].map((k) => ({ path: ['prof', k], record: 'image' })),
  // audio.bgm: the tracks by name — not combatAlts, a list of tracks the client reads by round
  { path: ['audio', 'bgm'], record: 'track', keys: ['lobby', 'prep', 'combat', 'unite', 'boss'] },
  { path: ['audio', 'bossBgm'], record: 'track' },
  { path: ['audio', 'voice'], record: { each: 'audioList', key: SLOT } },
  { path: ['audio', 'voiceJp'], record: { each: 'audioList', key: SLOT } },
  // the other official dubs of round 40 (DESIGN §32.14.11): English, Korean, the operator's own-language dub
  { path: ['audio', 'voiceEn'], record: { each: 'audioList', key: SLOT } },
  { path: ['audio', 'voiceKr'], record: { each: 'audioList', key: SLOT } },
  { path: ['audio', 'voiceNative'], record: { each: 'audioList', key: SLOT } },
  { path: ['audio', 'sfx', 'ui'], record: 'audio' },
  { path: ['audio', 'sfx', 'battle'], record: 'audio' },
  { path: ['audio', 'sfx', 'units'], record: SFX_UNIT },
]).map((c) => Object.freeze(c)));

/** The containers whose records may carry a local-client model (`spineLocal`) a written `spine` takes away. */
const LOCAL_MODELS = new Set(['enemies', 'tokens']);

/** The containers as a tree: section → (sub-section →)… → the container. */
const TREE = (() => {
  const root = {};
  for (const c of ASSET_CONTAINERS) {
    let node = root;
    c.path.forEach((k, i) => { node = node[k] ||= (i === c.path.length - 1 ? { $container: c } : {}); });
  }
  return root;
})();

/** A record key of the manifest (an id, a 'group/key' of `ui`): plain characters, never a name of Object.prototype. @param {unknown} k */
export const isAssetKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 128 && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(k) && !FORBIDDEN.has(k);

/** A skin key of an operator's record (see the header): wider than isAssetKey by '@' '#' '+', at most 64 characters. @param {unknown} k */
export const isSkinKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 64 && SKIN_KEY.test(k) && !FORBIDDEN.has(k);

/** The value at `path` of a plain-data tree (own properties only), or undefined. @param {any} obj @param {string[]} path */
export function getPath(obj, path) {
  let node = obj;
  for (const k of path) {
    if (!isObj(node) || !has(node, k)) return undefined;
    node = node[k];
  }
  return node;
}

/**
 * @typedef {{ anims: Record<string, any>, animations: Record<string, number>, events: string[],
 *   hits: Record<string, number[]>, bounds: { x: number, y: number, width: number, height: number } | null }} SpineMeta
 *   what plugin.lock.json holds of a skeleton (tools/assets/skel.mjs, anim-roles.mjs — the fields of a manifest Spine)
 * @typedef {{ skel: string, atlas: string, textures: string[], pma: boolean, meta?: SpineMeta }} SpineOp
 * @typedef {{ at: string[], file?: string, files?: string[], track?: { loop: string, intro?: string }, spine?: SpineOp,
 *   text?: string, ref?: string, from?: string[], clear?: true, implied?: true }} AssetOp
 *   one write of an overlay (see the header); `clear`: the entry's value taken away (an enemy's or a token's
 *   `spineLocal` when its model is written — `implied`: a consequence of another write, never an override of its own)
 * @typedef {{ at: string[], value: any }} ResolvedOp
 *   a write with its value (applyOps): `undefined` takes the entry away
 * @typedef {{ ops: AssetOp[], files: string[], models: string[][], copyBytes: number, problems: string[], warnings: string[],
 *   issues: import('./errors.js').PluginIssue[] }} AssetOverlay
 *   copyBytes: what its references copy out of the installation's manifest (JSON text; 0 without the manifest); issues: the
 *   problems and warnings with their codes (shared/plugins/errors.js; `at` the path in the manifest: ['assets', …])
 */

const pathText = (at) => `assets.${at.join('.')}`;
const kindName = (kind) => (typeof kind === 'string' ? (kind === 'audioList' ? 'audio' : kind === 'spine' ? 'Spine model' : kind) : 'record');
/** The write that takes away an enemy's or a token's local-client model when its `spine` is written (see the header). */
const localModelClear = (loc) => (LOCAL_MODELS.has(loc.container[0]) && loc.field.length === 1 && loc.field[0] === 'spine'
  ? { at: [...loc.container, loc.key, 'spineLocal'], clear: /** @type {true} */ (true), implied: /** @type {true} */ (true) } : null);

/**
 * Read a cosmetic plugin's `assets` part (see the header): its shape, the files it names, its references and the
 * permissions they need.
 * @param {unknown} assets the parsed overlay
 * @param {{ vanilla?: any, permissions?: string[] | null, has?: ((rel: string) => boolean) | null }} [ctx]
 *   vanilla: the installation's manifest (data/assets.json) — references must name one of its entries and a write to an
 *   entry it has needs `assets.override`, a new entry `assets.add` (unchecked without it); permissions: the manifest's;
 *   has: whether the plugin folder holds a file (unchecked without it)
 * @returns {AssetOverlay}
 */
export function readAssetOverlay(assets, { vanilla = null, permissions = null, has: hasFile = null } = {}) {
  const list = issueList();
  const { problems, warnings, issues } = list;
  /** @type {AssetOp[]} */ const ops = [];
  /** @type {string[]} */ const files = [];
  /** @type {string[][]} */ const models = [];
  let copyBytes = 0;
  const addFile = (rel) => { if (!files.includes(rel)) files.push(rel); };
  /** The path of an overlay location in the manifest (an issue's `at`). @param {string[]} at */
  const where = (at) => ['assets', ...at];
  if (!isObj(assets)) {
    list.problem('PLUGIN_ASSETS_SHAPE', '"assets" is not an object in the shape of data/assets.json', { at: ['assets'] });
    return { ops, files, models, copyBytes, problems, warnings, issues };
  }

  /** A plugin file of an allowed extension (else a problem, false). */
  const fileOk = (rel, exts, at) => {
    if (typeof rel !== 'string' || !isPackPath(rel)) { list.problem('PLUGIN_ASSET_FILE', `${pathText(at)}: ${short(rel)} is not a path inside the plugin folder`, { at: where(at) }); return false; }
    if (!exts.includes(extOf(rel))) { list.problem('PLUGIN_ASSET_FILE', `${pathText(at)}: ${rel} is not ${exts.join(' / ')}`, { at: where(at), file: rel, exts }); return false; }
    if (hasFile && !hasFile(rel)) { list.problem('PLUGIN_FILE_MISSING', `${pathText(at)}: ${rel} is missing`, { at: where(at), file: rel }); return false; }
    return true;
  };

  /** A Spine object (see the header) → a SpineOp, or null with a problem. */
  const readSpine = (v, at) => {
    for (const k of Object.keys(v)) {
      if (k === 'anims' && v.anims === 'auto') continue;
      if (['animations', 'events', 'hits', 'bounds', 'anims'].includes(k)) { list.problem('PLUGIN_SPINE', `${pathText(at)}.${k}: a plugin's Spine clips come from ${LOCK_FILE} (node tools/plugin.mjs pack), never by hand — write "anims": "auto" or leave it out`, { at: where([...at, k]) }); return null; }
      if (!['skel', 'atlas', 'textures', 'pma'].includes(k)) list.warning('PLUGIN_ASSET_IGNORED', `${pathText(at)}.${k} is not a field of a Spine model (ignored)`, { at: where([...at, k]) });
    }
    if (!fileOk(v.skel, ['.skel'], [...at, 'skel'])) return null;
    const dir = v.skel.replace(/[^/]*$/, '');
    const name = v.skel.slice(dir.length, -'.skel'.length);
    const atlas = v.atlas === undefined ? `${dir}${name}.atlas` : v.atlas;
    if (!fileOk(atlas, ['.atlas'], [...at, 'atlas'])) return null;
    if (atlas !== `${dir}${name}.atlas`) { list.problem('PLUGIN_SPINE', `${pathText(at)}.atlas: ${atlas} — the atlas sits next to its skeleton with the same name (${dir}${name}.atlas): pixi-spine looks for it there`, { at: where([...at, 'atlas']), file: atlas }); return null; }
    const textures = v.textures === undefined ? [`${dir}${name}.png`] : v.textures;
    if (!Array.isArray(textures) || !textures.length || textures.length > 64) { list.problem('PLUGIN_SPINE', `${pathText(at)}.textures: not a list of 1–64 page images`, { at: where([...at, 'textures']) }); return null; }
    for (const [i, t] of textures.entries()) {
      if (!fileOk(t, IMAGE, [...at, 'textures', String(i)])) return null;
      if (!t.startsWith(dir)) { list.problem('PLUGIN_SPINE', `${pathText(at)}.textures: ${t} is outside the atlas's folder (${dir || 'the plugin folder'}) — its pages are found next to it`, { at: where([...at, 'textures', String(i)]), file: t }); return null; }
    }
    if (v.pma !== undefined && typeof v.pma !== 'boolean') { list.problem('PLUGIN_SPINE', `${pathText(at)}.pma: not true or false`, { at: where([...at, 'pma']) }); return null; }
    const model = [v.skel, atlas, ...new Set(textures)];
    for (const rel of model) addFile(rel);
    models.push(model);
    return { skel: v.skel, atlas, textures: [...new Set(textures)], pma: v.pma === true };
  };

  /**
   * One value of a record (see the header).
   * @param {AssetKind} kind @param {unknown} v @param {{ container: string[], key: string, field: string[] }} loc
   */
  const readValue = (kind, v, loc) => {
    const at = [...loc.container, loc.key, ...loc.field];
    if (ops.length >= VISUAL_LIMITS.ops) { if (ops.length === VISUAL_LIMITS.ops) list.problem('PLUGIN_LIMIT', `more than ${VISUAL_LIMITS.ops} writes`, { detail: `more than ${VISUAL_LIMITS.ops} writes` }); return; }
    if (kind === 'text') {
      // a line of the manifest (a skin's name or series): never a reference, never anything but a short text.
      // A skin's series may be empty (an outfit a plugin itself adds may have no series; every operator skin of the
      // official table has one); its name may not.
      const min = loc.field[loc.field.length - 1] === 'group' ? 0 : 1;
      const n = typeof v === 'string' ? [...v].length : -1;
      if (n < min || n > TEXT_MAX) {
        list.problem('PLUGIN_ASSETS_SHAPE', `${pathText(at)}: not a text of ${min}–${TEXT_MAX} characters`, { at: where(at) });
        return;
      }
      ops.push({ at, text: /** @type {string} */ (v) });
      return;
    }
    if (isObj(v) && has(v, 'ref')) {
      const key = /** @type {any} */ (v).ref;
      if (!isAssetKey(key)) { list.problem('PLUGIN_REF', `${pathText(at)}: { "ref": ${short(key)} } does not name an entry`, { at: where(at) }); return; }
      const from = [...loc.container, key, ...loc.field];
      const target = vanilla ? getPath(vanilla, from) : undefined;
      if (vanilla && target === undefined) {
        list.problem('PLUGIN_REF', `${pathText(at)}: { "ref": "${key}" } — this installation's art manifest (data/assets.json) has no ${from.join('.')}`, { at: where(at), ref: key });
        return;
      }
      // measured until the plugin is over the budget (then it is refused anyway: no need to measure the rest)
      if (vanilla && copyBytes <= VISUAL_LIMITS.copyBytes) copyBytes += JSON.stringify(target).length;
      ops.push({ at, ref: key, from });
      const clear = localModelClear(loc);
      if (clear) ops.push(clear);
      const rest = Object.keys(v).filter((k) => k !== 'ref');
      if (!rest.length) return;
      if (typeof kind === 'string') { list.problem('PLUGIN_REF', `${pathText(at)}: a reference to ${kind === 'audioList' ? 'an' : 'a'} ${kindName(kind)} takes no other key (${rest.join(', ')})`, { at: where(at) }); return; }
      readFields(kind, Object.fromEntries(rest.map((k) => [k, v[k]])), loc);
      return;
    }
    if (kind === 'image' || kind === 'audio') {
      if (fileOk(v, kind === 'image' ? IMAGE : AUDIO, at)) { ops.push({ at, file: /** @type {string} */ (v) }); addFile(v); }
      return;
    }
    if (kind === 'audioList') {
      if (typeof v === 'string') { if (fileOk(v, AUDIO, at)) { ops.push({ at, file: v }); addFile(v); } return; }
      if (!Array.isArray(v) || !v.length || v.length > VISUAL_LIMITS.listFiles) { list.problem('PLUGIN_ASSETS_SHAPE', `${pathText(at)}: not an audio file or a list of 1–${VISUAL_LIMITS.listFiles}`, { at: where(at) }); return; }
      if (v.every((rel, i) => fileOk(rel, AUDIO, [...at, String(i)]))) { ops.push({ at, files: [...v] }); for (const rel of v) addFile(rel); }
      return;
    }
    if (kind === 'track') {
      const tr = /** @type {any} */ (v);
      if (!isObj(tr) || tr.loop === undefined) { list.problem('PLUGIN_ASSETS_SHAPE', `${pathText(at)}: not a track { "loop", "intro"? } or a reference`, { at: where(at) }); return; }
      for (const k of Object.keys(tr)) if (k !== 'loop' && k !== 'intro') list.warning('PLUGIN_ASSET_IGNORED', `${pathText(at)}.${k} is not a field of a track (ignored)`, { at: where([...at, k]) });
      if (!fileOk(tr.loop, AUDIO, [...at, 'loop']) || (tr.intro !== undefined && !fileOk(tr.intro, AUDIO, [...at, 'intro']))) return;
      ops.push({ at, track: { loop: tr.loop, ...(tr.intro !== undefined ? { intro: tr.intro } : {}) } });
      addFile(tr.loop);
      if (tr.intro !== undefined) addFile(tr.intro);
      return;
    }
    if (kind === 'spine') {
      if (!isObj(v) || typeof /** @type {any} */ (v).skel !== 'string') { list.problem('PLUGIN_SPINE', `${pathText(at)}: not a Spine model { "skel", "atlas", "textures" } or a reference`, { at: where(at) }); return; }
      const spine = readSpine(v, at);
      if (spine) {
        ops.push({ at, spine });
        const clear = localModelClear(loc);
        if (clear) ops.push(clear);
      }
      return;
    }
    if (!isObj(v)) { list.problem('PLUGIN_ASSETS_SHAPE', `${pathText(at)}: ${short(v)} is not an object of fields (${'fields' in kind ? Object.keys(kind.fields).join(', ') : 'keyed entries'})`, { at: where(at) }); return; }
    readFields(kind, /** @type {Record<string, unknown>} */ (v), loc);
  };

  /** The fields of an object kind. @param {any} kind @param {Record<string, unknown>} obj @param {{ container: string[], key: string, field: string[] }} loc */
  const readFields = (kind, obj, loc) => {
    if (kind.max !== undefined && Object.keys(obj).length > kind.max) {
      const at = [...loc.container, loc.key, ...loc.field];
      const text = `more than ${kind.max} entries under ${pathText(at)}`;
      list.problem('PLUGIN_LIMIT', text, { at: where(at), detail: text });
      return;
    }
      for (const [k, x] of Object.entries(obj)) {
        const at = [...loc.container, loc.key, ...loc.field, k];
        let sub;
        if (kind.fields) sub = has(kind.fields, k) ? kind.fields[k] : undefined;
        else if (!kind.key.test(k) || FORBIDDEN.has(k)) {
          // a free-key map (a skin's key, a voice slot, a skill index): a key of the wrong shape addresses nothing
          // the game can look up. This batch's `skins` map refuses it; the older maps keep their warning, so the
          // change stays inside one container.
          const at2 = where(at);
          const text = `${pathText(at)} is not a ${kind.keyName || 'key'}`;
          if (kind.keyProblem) list.problem('PLUGIN_ASSET_KEY', text, { at: at2, where: String(k) });
          else list.warning('PLUGIN_ASSET_IGNORED', `${pathText(at)} is not a field a cosmetic plugin changes (ignored)`, { at: at2 });
          continue;
        } else sub = kind.each;
        if (!sub) { list.warning('PLUGIN_ASSET_IGNORED', `${pathText(at)} is not a field a cosmetic plugin changes (ignored)`, { at: where(at) }); continue; }
        readValue(sub, x, { ...loc, field: [...loc.field, k] });
      }
  };

  /** The tree of sections down to the containers. */
  const walk = (node, obj, path) => {
    for (const [k, x] of Object.entries(obj)) {
      const at = [...path, k];
      const next = has(node, k) ? node[k] : null;
      if (!next) { list.warning('PLUGIN_ASSET_IGNORED', `${pathText(at)} is not something a cosmetic plugin changes (ignored)`, { at: where(at) }); continue; }
      if (!isObj(x)) { list.problem('PLUGIN_ASSETS_SHAPE', `${pathText(at)}: not an object`, { at: where(at) }); continue; }
      const c = /** @type {AssetContainer | undefined} */ (next.$container);
      if (!c) { walk(next, x, at); continue; }
      for (const [key, v] of Object.entries(x)) {
        if (!isAssetKey(key)) { list.problem('PLUGIN_ASSET_KEY', `${pathText(at)}: ${short(key)} is not an entry key (letters, digits, _ . / -)`, { at: where([...at, String(key)]), where: String(key) }); continue; }
        if (c.keys && !c.keys.includes(key)) { list.warning('PLUGIN_ASSET_IGNORED', `${pathText([...at, key])} is not one of ${c.keys.join(', ')} (ignored)`, { at: where([...at, key]) }); continue; }
        readValue(c.record, v, { container: c.path, key, field: [] });
      }
    }
  };
  walk(TREE, assets, []);
  if (copyBytes > VISUAL_LIMITS.copyBytes) {
    const text = `its references copy more than ${VISUAL_LIMITS.copyBytes / 1048576} MB of this installation's manifest`;
    list.problem('PLUGIN_LIMIT', text, { at: ['assets'], detail: text });
  }

  // what the writes need: an entry of the installation's manifest → assets.override, a new one → assets.add
  if (vanilla && Array.isArray(permissions)) {
    const told = new Set();
    for (const op of ops) {
      if (op.implied) continue;
      const depth = ASSET_CONTAINERS.find((c) => c.path.every((k, i) => op.at[i] === k))?.path.length ?? 1;
      const exists = getPath(vanilla, op.at.slice(0, depth + 1)) !== undefined;
      const need = exists ? 'assets.override' : 'assets.add';
      if (!permissions.includes(need) && !told.has(need)) {
        told.add(need);
        list.problem('PLUGIN_PERMISSION_MISSING', `${pathText(op.at)}: ${exists ? 'changes an entry of this installation\'s manifest' : 'adds an entry'} — needs the permission "${need}"`, { at: where(op.at), need, needs: [need] });
      }
    }
  }
  return { ops, files, models, copyBytes, problems, warnings, issues };
}

// ---- plugin.lock.json -------------------------------------------------------------------------------------------------

const isHex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
/** A path key of the lock: a plain path, never a name of Object.prototype in it (the maps have no prototype either). */
const lockPath = (rel) => isPackPath(rel) && !String(rel).split('/').some((x) => FORBIDDEN.has(x));
const clipName = (v, names) => typeof v === 'string' && v.length <= LOCK_LIMITS.name && Object.prototype.hasOwnProperty.call(names, v);
const VIA = ['combat', 'attackAny', 'skill', 'idle', 'attack'];
/** The roles of a model (tools/assets/anim-roles.mjs Roles): a clip name or null … */
const NAME_ROLES = ['idle', 'deploy', 'die'];
/** … or a clip { begin, loop, end, via? } (`skill`: a skill clip, with its index and idle) or null; `skills`: skill clips by index. */
const CLIP_ROLES = ['attack', 'attackDown', 'move', 'run', 'stun', 'skill'];

/**
 * One clip of a lock's roles, rebuilt with exactly its fields, or undefined when it is not one. Every name it plays must be
 * an animation of the skeleton (`names`).
 * @param {unknown} v @param {Record<string, number>} names @param {boolean} skill a skill clip (index, idle)
 */
function readClip(v, names, skill) {
  if (!isObj(v)) return undefined;
  const c = /** @type {any} */ (v);
  const opt = (x) => x === null || x === undefined || clipName(x, names);
  if (!clipName(c.loop, names) || !opt(c.begin) || !opt(c.end) || (c.via !== undefined && !VIA.includes(c.via))) return undefined;
  /** @type {Record<string, any>} */
  const out = { begin: c.begin ?? null, loop: c.loop, end: c.end ?? null };
  if (c.via !== undefined) out.via = c.via;
  if (skill) {
    if (!Number.isInteger(c.index) || c.index < 0 || c.index >= LOCK_LIMITS.skills || !opt(c.idle)) return undefined;
    out.index = c.index;
    out.idle = c.idle ?? null;
  }
  return out;
}

/**
 * A lock's roles (`anims`) rebuilt in the shape anim-roles.mjs writes — the known roles only, each a clip name of the
 * skeleton, a clip of them or null — or null when it is not that.
 * @param {unknown} v @param {Record<string, number>} names
 * @returns {Record<string, any> | null}
 */
function readRoles(v, names) {
  if (!isObj(v)) return null;
  const a = /** @type {any} */ (v);
  for (const k of Object.keys(a)) if (!NAME_ROLES.includes(k) && !CLIP_ROLES.includes(k) && k !== 'skills') return null;
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of NAME_ROLES) {
    if (a[k] === undefined) continue;
    if (a[k] !== null && !clipName(a[k], names)) return null;
    out[k] = a[k];
  }
  if (typeof out.idle !== 'string') return null; // every model idles (resolveRoles)
  for (const k of CLIP_ROLES) {
    if (a[k] === undefined) continue;
    if (a[k] === null) { out[k] = null; continue; }
    const c = readClip(a[k], names, k === 'skill');
    if (!c) return null;
    out[k] = c;
  }
  if (a.skills !== undefined) {
    if (!isObj(a.skills)) return null;
    const keys = Object.keys(a.skills);
    if (keys.length > LOCK_LIMITS.skills) return null;
    out.skills = {};
    for (const i of keys) {
      const c = /^\d$/.test(i) ? readClip(a.skills[i], names, true) : undefined;
      if (!c) return null;
      out.skills[i] = c;
    }
  }
  return out;
}

/**
 * The clip data of one skeleton in a lock, rebuilt field by field within LOCK_LIMITS (nothing of the file passes as it
 * is), or null when it is not that.
 * @param {unknown} v
 * @returns {(SpineMeta & { sha256: string }) | null}
 */
function readLockSpine(v) {
  if (!isObj(v)) return null;
  const s = /** @type {any} */ (v);
  if (!isHex64(s.sha256) || !isObj(s.animations) || !Array.isArray(s.events) || !isObj(s.hits)) return null;
  const durations = Object.entries(s.animations);
  if (!durations.length || durations.length > LOCK_LIMITS.animations) return null;
  /** @type {Record<string, number>} */
  const animations = Object.create(null);
  for (const [name, d] of durations) {
    if (!name || name.length > LOCK_LIMITS.name || typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > LOCK_LIMITS.duration) return null;
    animations[name] = d;
  }
  if (s.events.length > LOCK_LIMITS.events || !s.events.every((e) => typeof e === 'string' && e.length <= LOCK_LIMITS.name)) return null;
  /** @type {Record<string, number[]>} */
  const hits = Object.create(null);
  for (const [name, list] of Object.entries(s.hits)) {
    if (!clipName(name, animations) || !Array.isArray(list) || list.length > LOCK_LIMITS.hits
      || !list.every((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= LOCK_LIMITS.duration)) return null;
    hits[name] = [...list];
  }
  const anims = readRoles(s.anims, animations);
  if (!anims) return null;
  let bounds = null;
  if (s.bounds !== null) {
    const b = s.bounds;
    const num = (x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= LOCK_LIMITS.bounds;
    if (!isObj(b) || !num(b.x) || !num(b.y) || !num(b.width) || !num(b.height)) return null;
    bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  return { sha256: s.sha256, anims, animations: { ...animations }, events: [...s.events], hits: { ...hits }, bounds };
}

/**
 * @typedef {{ files: Record<string, { sha256: string, bytes: number }>, spine: Record<string, SpineMeta & { sha256: string }> }} PluginLock
 */

/**
 * Read plugin.lock.json (tools/plugin.mjs pack): `{ lock: 1, id, version, generator, files: { <path>: { sha256, bytes } },
 * spine: { <skel path>: { sha256, anims, animations, events, hits, bounds } } }`. Each skeleton's clip data is rebuilt in
 * the shape tools/assets/anim-roles.mjs and skel.mjs write, within LOCK_LIMITS — the roles a known set, every clip they
 * play an animation of the skeleton, names, counts, durations and bounds bounded — so nothing a hand-made lock adds
 * reaches a browser; the maps have no prototype. A broken lock is a problem; it is only ever needed for Spine models
 * (attachSpineMeta). The server never parses the skeleton itself: the lock is tied to it by its SHA-256 [ASSUMED].
 * @param {unknown} raw
 * @returns {{ lock: PluginLock | null, problems: string[], issues: import('./errors.js').PluginIssue[] }}
 */
export function readPluginLock(raw) {
  const list = issueList();
  const bad = (why) => { list.problem('PLUGIN_LOCK', `${LOCK_FILE}: ${why} — write it again with node tools/plugin.mjs pack`, { file: LOCK_FILE }); return { lock: null, problems: list.problems, issues: list.issues }; };
  if (!isObj(raw)) return bad('not a JSON object');
  const r = /** @type {any} */ (raw);
  if (r.lock !== LOCK_VERSION) return bad(`"lock": ${short(r.lock)} is not ${LOCK_VERSION}`);
  /** @type {PluginLock} */
  const lock = { files: Object.create(null), spine: Object.create(null) };
  for (const [rel, f] of Object.entries(isObj(r.files) ? r.files : {})) {
    if (!lockPath(rel) || !isObj(f) || !isHex64(f.sha256) || !Number.isInteger(f.bytes) || f.bytes < 0) return bad(`files.${short(rel)} is not { sha256, bytes }`);
    lock.files[rel] = { sha256: f.sha256, bytes: f.bytes };
  }
  for (const [rel, s] of Object.entries(isObj(r.spine) ? r.spine : {})) {
    const meta = lockPath(rel) && /\.skel$/.test(rel) ? readLockSpine(s) : null;
    if (!meta) return bad(`spine.${short(rel)} is not the clip data of a skeleton (roles, animations, events, hits, bounds) within its limits`);
    lock.spine[rel] = meta;
  }
  return { lock, problems: list.problems, issues: list.issues };
}

/**
 * Give every Spine model of the ops its clip data from the lock — when the lock's entry was made from the skeleton the
 * folder holds now (its SHA-256); else a problem (a missing or stale lock).
 * @param {AssetOp[]} ops
 * @param {PluginLock | null} lock
 * @param {(rel: string) => string | null} sha the SHA-256 of a file of the plugin
 * @returns {{ ops: AssetOp[], problems: string[], issues: import('./errors.js').PluginIssue[] }}
 */
export function attachSpineMeta(ops, lock, sha) {
  const list = issueList();
  const out = ops.map((op) => {
    if (!op.spine) return op;
    const e = lock?.spine?.[op.spine.skel];
    if (!e) { list.problem('PLUGIN_LOCK_MISSING', `${pathText(op.at)}: ${LOCK_FILE} has no clip data for ${op.spine.skel} — run node tools/plugin.mjs pack`, { at: ['assets', ...op.at], file: op.spine.skel }); return op; }
    if (e.sha256 !== sha(op.spine.skel)) { list.problem('PLUGIN_LOCK_STALE', `${pathText(op.at)}: ${LOCK_FILE} was made from another ${op.spine.skel} — run node tools/plugin.mjs pack again`, { at: ['assets', ...op.at], file: op.spine.skel }); return op; }
    const { anims, animations, events, hits, bounds } = e;
    return { ...op, spine: { ...op.spine, meta: { anims, animations, events, hits, bounds } } };
  });
  return { ops: out, problems: list.problems, issues: list.issues };
}

// ---- URLs, resolution, merge ------------------------------------------------------------------------------------------

/** The served URL of a plugin file: /p/<id>/<hash8>/<path>, every segment URL-encoded. */
export const pluginFileUrl = (id, hash8, rel) => `${PLUGIN_FILES_URL}${id}/${hash8}/${String(rel).split('/').map(encodeURIComponent).join('/')}`;

/** The hash of a Spine model: the SHA-256 of its files' SHA-256s, one per line (skeleton, atlas, pages). @param {string[]} shas */
export const modelHashOf = (shas) => sha256Hex(shas.join('\n'));

/**
 * Where a path of the manifest lands among the containers (see the header): the container, the record key, the fields
 * below it and the kind there (AssetKind: 'image', 'spine' … or an object kind — a whole record, `spine` of an
 * operator), or null for a path outside them (another section, a key that is no entry key, a field a record has not).
 * @param {unknown} at
 * @returns {{ container: string[], key: string, field: string[], kind: AssetKind } | null}
 */
export function locateAssetPath(at) {
  if (!Array.isArray(at) || at.length < 2 || at.length > 8 || !at.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 128 && !FORBIDDEN.has(k))) return null;
  let node = TREE;
  for (let i = 0; i < at.length; i++) {
    node = has(node, at[i]) ? node[at[i]] : null;
    if (!node) return null;
    const c = /** @type {AssetContainer | undefined} */ (node.$container);
    if (!c) continue;
    const key = at[i + 1];
    if (!isAssetKey(key) || (c.keys && !c.keys.includes(key))) return null;
    const field = at.slice(i + 2);
    /** @type {any} */
    let kind = c.record;
    for (const f of field) {
      if (typeof kind === 'string') return null;
      kind = kind.fields ? (has(kind.fields, f) ? kind.fields[f] : null) : (kind.key.test(f) ? kind.each : null);
      if (!kind) return null;
    }
    return { container: c.path, key, field, kind };
  }
  return null;
}

/**
 * @typedef {{ at: string[], value: any, urls: string[], after?: PreparedOp } | { at: string[], from: string[] }} PreparedOp
 *   a write of a set's document made ready for any manifest: its value with the plugin URLs it writes, or a reference
 *   (`from`: the path it copies, read out of the manifest it is laid over — layVisualOps); `after`: the write an implied
 *   clear goes with (an enemy's or a token's `spineLocal` taken away only when its new model is written)
 * @typedef {{ ops: PreparedOp[], urls: Set<string>, dropped: string[], droppedCount: number }} PreparedSet
 *   urls: every plugin URL the set writes; dropped: why ops were left out (the first 16), droppedCount: how many
 */

/** At most this many reasons are kept of the ops a document drops (the count is exact). */
const DROPPED_KEPT = 16;

/**
 * A checked set document (checkVisualDoc) made ready to be laid over a manifest (see the header): every plugin URL built
 * from the composition's file table — never taken from the document —, every op checked against the field it writes, in
 * the composition's load order. What does not fit is dropped (with the reason): that entry keeps the art beneath it.
 * @param {any} doc `{ visual: { overlays: [{ id, version, files }] }, writes: [{ id, ops }] }`
 * @returns {PreparedSet}
 */
export function prepareVisualDoc(doc) {
  /** @type {PreparedOp[]} */
  const ops = [];
  /** @type {Set<string>} */
  const urls = new Set();
  /** @type {string[]} */
  const dropped = [];
  let droppedCount = 0;
  const overlays = isObj(doc) && isObj(doc.visual) && Array.isArray(doc.visual.overlays) ? doc.visual.overlays : [];
  /** @type {Map<string, any[]>} */
  const writes = new Map();
  for (const w of isObj(doc) && Array.isArray(doc.writes) ? doc.writes : []) {
    if (isObj(w) && typeof w.id === 'string' && Array.isArray(w.ops) && !writes.has(w.id)) writes.set(w.id, w.ops);
  }
  for (const o of overlays) {
    if (!isObj(o) || typeof o.id !== 'string' || !isObj(o.files)) continue;
    const id = o.id;
    const files = o.files;
    const list = writes.get(id) || [];
    const drop = (at, why) => {
      droppedCount++;
      if (dropped.length < DROPPED_KEPT) dropped.push(`${id}: ${Array.isArray(at) ? pathText(at.map(String)) : 'assets'}: ${why}`);
    };
    /** The URL of a file of the composition, of one of `exts` (null: not one). */
    const fileUrl = (rel, exts, hash = null) => {
      if (typeof rel !== 'string' || !isPackPath(rel) || !exts.includes(extOf(rel)) || !has(files, rel) || !isHex64(files[rel])) return null;
      return pluginFileUrl(id, String(hash || files[rel]).slice(0, FILE_URL_DIGITS), rel);
    };
    /** @type {PreparedOp | null} what the previous write became (null: dropped) — an implied clear goes with it */
    let prev = null;
    for (const [n, op] of list.entries()) {
      if (n >= VISUAL_LIMITS.ops) { drop(null, `more than ${VISUAL_LIMITS.ops} writes`); break; }
      const before = ops.length;
      prepareOne(op);
      prev = ops.length > before ? ops[ops.length - 1] : null;
    }
    /** One op of the plugin `id` → pushed onto `ops` (prepared), or dropped with its reason. @param {any} op */
    function prepareOne(op) {
      if (!isObj(op)) { drop(null, 'not a write'); return; }
      const at = op.at;
      // an implied clear: an enemy's or a token's local-client model, taken away with the write of its model just before
      // it (readAssetOverlay puts it there) — dropped with that write, left out with it when its file fails (its URLs)
      // or its reference is missing (layVisualOps `after`); else the entry would lose its local model for nothing
      if (op.clear === true) {
        const path = Array.isArray(at) && at.length === 3 && LOCAL_MODELS.has(at[0]) && isAssetKey(at[1]) && at[2] === 'spineLocal';
        const parent = path && prev && prev.at.length === 3 && prev.at[0] === at[0] && prev.at[1] === at[1] && prev.at[2] === 'spine' ? prev : null;
        if (parent) ops.push({ at: [...at], value: undefined, urls: 'urls' in parent ? parent.urls : [], after: parent });
        else drop(at, path ? 'a clear of a local-client model whose model write is left out' : 'a clear of something else than a local-client model');
        return;
      }
      const loc = locateAssetPath(at);
      if (!loc) { drop(at, 'not something a cosmetic plugin changes'); return; }
      const kind = loc.kind;
      if (op.from !== undefined) {
        const from = op.from;
        const depth = loc.container.length;
        const ok = Array.isArray(from) && from.length === at.length && loc.container.every((k, i) => from[i] === k) && isAssetKey(from[depth])
          && loc.field.every((k, i) => from[depth + 1 + i] === k);
        if (ok) ops.push({ at: [...at], from: [...from] });
        else drop(at, 'a reference to another place than the same field of an entry of its container');
        return;
      }
      if (op.file !== undefined) {
        const u = kind === 'image' ? fileUrl(op.file, IMAGE) : kind === 'audio' || kind === 'audioList' ? fileUrl(op.file, AUDIO) : null;
        if (u) { ops.push({ at: [...at], value: u, urls: [u] }); urls.add(u); } else drop(at, `${short(op.file)} is no ${kindName(kind)} of the set`);
        return;
      }
      if (op.files !== undefined) {
        const list2 = kind === 'audioList' && Array.isArray(op.files) && op.files.length && op.files.length <= VISUAL_LIMITS.listFiles ? op.files.map((rel) => fileUrl(rel, AUDIO)) : null;
        if (list2 && list2.every(Boolean)) { ops.push({ at: [...at], value: list2, urls: list2 }); for (const u of list2) urls.add(u); } else drop(at, 'not a list of audio files of the set');
        return;
      }
      if (op.text !== undefined) {
        // a line of the manifest (a skin's name or series): written as it is, no URL of the set.
        // An empty series is written too (an outfit a plugin adds may have none).
        const emptyOk = at[at.length - 1] === 'group';
        const value = kind === 'text' && typeof op.text === 'string'
          && (op.text.length > 0 || emptyOk) && [...op.text].length <= TEXT_MAX ? op.text : null;
        if (value !== null) ops.push({ at: [...at], value, urls: [] }); else drop(at, 'not a text of the set');
        return;
      }
      if (op.track !== undefined) {
        const tr = op.track;
        const loop = kind === 'track' && isObj(tr) ? fileUrl(tr.loop, AUDIO) : null;
        const intro = loop && tr.intro !== undefined ? fileUrl(tr.intro, AUDIO) : null;
        if (loop && (tr.intro === undefined || intro)) {
          const value = intro ? { intro, loop } : { loop };
          ops.push({ at: [...at], value, urls: intro ? [intro, loop] : [loop] });
          urls.add(loop);
          if (intro) urls.add(intro);
        } else drop(at, 'not a track of audio files of the set');
        return;
      }
      if (op.spine !== undefined) {
        const sp = op.spine;
        const value = kind === 'spine' && isObj(sp) ? spineValue(sp, files, fileUrl) : null;
        if (value) { ops.push({ at: [...at], value, urls: [value.skel, value.atlas, ...value.textures] }); for (const u of [value.skel, value.atlas, ...value.textures]) urls.add(u); } else drop(at, 'not a Spine model of the set (its files, its folder, its clip data)');
        return;
      }
      drop(at, 'not a write a cosmetic plugin makes');
    }
  }
  return { ops, urls, dropped, droppedCount };
}

/**
 * A Spine op of a set document as the manifest's Spine object, its URLs built from the file table (the model's hash for
 * every file of it), its clip data rebuilt in the lock's shape — or null when it is not one (see readSpine and
 * readLockSpine: the atlas beside its skeleton with its name, the pages in the atlas's folder, the clip data within
 * LOCK_LIMITS).
 * @param {any} sp @param {Record<string, string>} files @param {(rel: unknown, exts: readonly string[], hash?: string | null) => string | null} fileUrl
 */
function spineValue(sp, files, fileUrl) {
  if (typeof sp.skel !== 'string' || !isPackPath(sp.skel) || extOf(sp.skel) !== '.skel') return null;
  const dir = sp.skel.replace(/[^/]*$/, '');
  const name = sp.skel.slice(dir.length, -'.skel'.length);
  if (sp.atlas !== `${dir}${name}.atlas` || !Array.isArray(sp.textures) || !sp.textures.length || sp.textures.length > 64) return null;
  if (!sp.textures.every((t) => typeof t === 'string' && t.startsWith(dir))) return null;
  const model = [sp.skel, sp.atlas, ...new Set(sp.textures)];
  if (!model.every((rel) => has(files, rel) && isHex64(files[rel]))) return null;
  const m = modelHashOf(model.map((rel) => files[rel]));
  const skel = fileUrl(sp.skel, ['.skel'], m);
  const atlas = fileUrl(sp.atlas, ['.atlas'], m);
  const textures = [...new Set(sp.textures)].map((rel) => fileUrl(rel, IMAGE, m));
  if (!skel || !atlas || !textures.every(Boolean)) return null;
  const meta = isObj(sp.meta) ? readLockSpine({ ...sp.meta, sha256: files[sp.skel] }) : null;
  if (!meta) return null;
  return { skel, atlas, textures: /** @type {string[]} */ (textures), pma: sp.pma === true, anims: meta.anims, animations: meta.animations, events: meta.events, hits: meta.hits, bounds: meta.bounds };
}

/**
 * Lay prepared sets over a manifest, in their order (the room's set, then the player's plugins): a reference copied out of
 * `base` itself — the page's own manifest (an entry it lacks is dropped, the reason in `dropped`) —, a write whose URL
 * failed to load (`failed`: public/js/assets.js) left out so its entry shows the art beneath it.
 * @param {any} base
 * @param {PreparedSet[]} sets
 * @param {{ failed?: Set<string> | null }} [opts]
 * @returns {{ manifest: any, dropped: string[] }}
 */
export function layVisualOps(base, sets, { failed = null } = {}) {
  /** @type {ResolvedOp[]} */
  const ops = [];
  /** @type {string[]} */
  const dropped = [];
  /** @type {Set<PreparedOp>} references left out here (the base lacks them): the clear that goes with one goes too */
  const missing = new Set();
  for (const set of sets) {
    for (const op of set.ops) {
      if ('from' in op) {
        const v = getPath(base, op.from);
        if (v === undefined) {
          missing.add(op);
          if (dropped.length < DROPPED_KEPT) dropped.push(`${pathText(op.at)}: this page's manifest has no ${op.from.join('.')}`);
          continue;
        }
        ops.push({ at: op.at, value: v });
        continue;
      }
      if (op.after && missing.has(op.after)) continue;
      if (failed && failed.size && op.urls.some((u) => failed.has(u))) continue;
      ops.push({ at: op.at, value: op.value });
    }
  }
  return { manifest: applyOps(base, ops), dropped };
}

/**
 * Lay resolved ops over a manifest: each value written whole at its path, the objects on the way copied — neither the
 * manifest nor an op's value is ever changed in place (a later op inside an earlier one's value copies it first). A path
 * through a name of Object.prototype is skipped. An undefined value takes the entry away (as JSON writes it: absent).
 * @param {any} manifest
 * @param {ResolvedOp[]} ops
 * @returns {any} the new manifest
 */
export function applyOps(manifest, ops) {
  const root = isObj(manifest) ? { ...manifest } : {};
  const fresh = new WeakSet([root]);
  for (const op of Array.isArray(ops) ? ops : []) {
    const at = op && Array.isArray(op.at) ? op.at : null;
    if (!at || !at.length || at.some((k) => typeof k !== 'string' || FORBIDDEN.has(k))) continue;
    let node = root;
    for (let i = 0; i < at.length - 1; i++) {
      const cur = has(node, at[i]) ? node[at[i]] : undefined;
      const next = isObj(cur) && fresh.has(cur) ? cur : isObj(cur) ? { ...cur } : {};
      fresh.add(next);
      node[at[i]] = next;
      node = next;
    }
    if (op.value === undefined) delete node[at[at.length - 1]];
    else node[at[at.length - 1]] = op.value;
  }
  return root;
}

/**
 * @typedef {{ code: 'override', params: { path: string, plugins: string[] } }} OverrideWarning
 *   two plugins of a set change the same thing — the same path, or one inside the other; the later one applies
 */

/**
 * The ops of a set's plugins in load order (one list), and an override warning wherever a plugin changes what an
 * earlier one's change in effect there — the same path, or one inside the other (at most VISUAL_LIMITS.warnings, one
 * per path and pair).
 * @template {{ at: string[] }} T
 * @param {{ id: string, ops: T[] }[]} plugins in load order
 * @returns {{ ops: T[], warnings: OverrideWarning[] }}
 */
export function mergePluginOps(plugins) {
  const key = (at) => at.join('\u0001');
  const owner = new Map();          // path key → the plugin whose write there is in effect (the last one)
  const below = new Map();          // path key → the keys written strictly inside it
  const ops = [];
  /** @type {OverrideWarning[]} */
  const warnings = [];
  const seen = new Set();
  const warn = (at, earlier, later) => {
    const k = `${key(at)}\u0002${earlier}\u0002${later}`;
    if (seen.has(k) || warnings.length >= VISUAL_LIMITS.warnings) return;
    seen.add(k);
    warnings.push({ code: 'override', params: { path: at.join('.'), plugins: [earlier, later] } });
  };
  for (const { id, ops: list } of plugins) {
    // checked against the earlier plugins only: a plugin never conflicts with itself; an implied write is the
    // consequence of one that is checked
    for (const op of list) {
      if (/** @type {any} */ (op).implied) { ops.push(op); continue; }
      const at = op.at;
      for (let n = 1; n <= at.length; n++) {
        const o = owner.get(key(at.slice(0, n)));
        if (o !== undefined && o !== id) warn(at, o, id);
      }
      for (const d of below.get(key(at)) || []) { const o = owner.get(d); if (o !== undefined && o !== id) warn(at, o, id); }
      ops.push(op);
    }
    for (const op of list) {
      if (/** @type {any} */ (op).implied) continue;
      const k0 = key(op.at);
      owner.set(k0, id);
      for (let n = 1; n < op.at.length; n++) {
        const k = key(op.at.slice(0, n));
        if (!below.has(k)) below.set(k, new Set());
        below.get(k).add(k0);
      }
    }
  }
  return { ops, warnings };
}

// ---- the visual hash and the served documents ----------------------------------------------------------------------

/**
 * @typedef {{ id: string, version: string, files: Record<string, string>, writes: string }} VisualOverlay
 *   a plugin's part of a `vs`: its id, version, the files that shape its overlay (SHA-256 each) and the hash of its ops
 *   (writesHashOf)
 * @typedef {{ v: number, assets: string, overlays: VisualOverlay[] }} VisualComposition
 */

/**
 * The `writes` of a plugin's part of a `vs` (see the header): the SHA-256 of the canonical JSON of its ops — exactly as
 * the server keeps and serves them (readAssetOverlay + attachSpineMeta: slots, file names, references, clip data; no
 * URL). The server computes it when it scans the plugin (server/plugins/registry.js), a browser over the ops a set's
 * document carries (checkVisualDoc). Throws on what has no JSON form (a browser's check catches it).
 * @param {unknown} ops
 * @returns {string}
 */
export const writesHashOf = (ops) => sha256Hex(canonicalJson(Array.isArray(ops) ? ops : []));

/**
 * The input of the visual hash (see the header), in its canonical shape.
 * @param {{ assets: string, overlays?: VisualOverlay[] }} parts assets: the SHA-256 of data/assets.json
 * @returns {VisualComposition}
 */
export function visualHashInput({ assets, overlays = [] }) {
  return {
    v: VISUAL_HASH_VERSION, assets: String(assets),
    overlays: overlays.map((o) => ({ id: String(o.id), version: String(o.version), files: { ...o.files }, writes: typeof o.writes === 'string' ? o.writes : '' })),
  };
}

/** The visual hash `vs` of a set (see the header): 64 lowercase hex digits. @param {{ assets: string, overlays?: VisualOverlay[] }} parts */
export const visualHashOf = (parts) => sha256Hex(canonicalJson(visualHashInput(parts)));

/**
 * The check a browser runs on a visual set's document (/vs/<vs16>/overlay.json: its `visual` block
 * `{ v, vs, assets, overlays }` and its `writes`): the composition hashes to the `vs` the room (or the catalogue) named,
 * and every plugin's ops hash to the `writes` of its part of it (writesHashOf) — one list per plugin of the composition,
 * none of another — so what the page lays is what `vs` names: every plugin URL is then built from that composition's
 * file table (prepareVisualDoc). null when it holds, else what is wrong (never throws).
 * @param {any} doc the parsed document
 * @param {string} vs the expected visual hash (64 hex)
 * @returns {string | null}
 */
export function checkVisualDoc(doc, vs) {
  if (!isVisualHash(vs)) return 'no visual hash to check against';
  const v = isObj(doc) ? doc.visual : null;
  if (!isObj(v) || v.v !== VISUAL_HASH_VERSION || typeof v.assets !== 'string' || !Array.isArray(v.overlays)) return 'not a visual set document';
  if (v.vs !== vs) return `the document names another set (${String(v.vs).slice(0, 16)})`;
  try {
    if (visualHashOf({ assets: v.assets, overlays: v.overlays }) !== vs) return 'its composition does not hash to its vs';
  } catch {
    return 'its composition is not plain data';
  }
  /** @type {Map<string, unknown>} plugin id → its ops */
  const writes = new Map();
  for (const w of Array.isArray(doc.writes) ? doc.writes : []) {
    if (!isObj(w) || typeof w.id !== 'string' || writes.has(w.id)) return 'its writes are not one list per plugin';
    writes.set(w.id, w.ops);
  }
  try {
    for (const o of v.overlays) {
      if (writesHashOf(writes.get(o.id) ?? []) !== o.writes) return `the writes of ${String(o.id).slice(0, 32)} are not the ones its vs names`;
      writes.delete(o.id);
    }
  } catch {
    return 'its writes are not plain data';
  }
  if (writes.size) return 'it has writes of a plugin its composition does not name';
  return null;
}
