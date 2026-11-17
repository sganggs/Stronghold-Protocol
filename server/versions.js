// server/versions.js — the official versions this server offers (DESIGN §35.23, M1; the registry: shared/versions.js;
// which ones: server/http/config.js versionsFrom). One service per server, built at boot:
//
//   * at boot, each enabled non-default version's content identity: its data/versions/<slug>/ files hashed (bytes only,
//     no JSON parse; server/plugins/identity.js versionContentOf) beside the vanilla code — a `cs` of its own — and its
//     config.json's modes read (small: offered() and the welcome need no full load). A version whose directory is missing
//     or unreadable is warned about and stays disabled;
//   * on first use (a room of that version, its manifest, its match host), its data — loadData of its directory,
//     deep-frozen, kept for the process —, its official-bounds snapshot (shared/plugins/officialBounds.js
//     officialBoundsOf: its own maxima, never the main process's cache) and its manifest (contentIndexOf: data URLs under
//     /data/versions/<slug>/, `version`, `bounds`);
//   * the default version (act2autochess) is the server's vanilla content: content(DEFAULT) is the vanilla shape, its
//     data the server's own; nothing of it changes.
//
// API (the lobby, the static server, the match hosts, /healthz):
//   ids / defaultId / nonDefault           enabled ids in registry order, the server's default, the enabled others
//   isEnabled(id), entry(id)               the registry entry of an enabled id, else null
//   available(id)                          enabled and playable: another version's data loads (loaded on first use; a
//                                          failed load is remembered — create / proposeVersion refuse it, welcome omits it)
//   csOf(id), idOfCs(cs)                   a version's cs (the vanilla cs for the default) and back
//   content(id)                            the room content base: frozen { cs, vanilla: true, version, plugins: [] }
//                                          (the default: { cs, vanilla: true, plugins: [] }, no `version`)
//   data(id), dataOfCs(cs)                 the version's data (lazy), null for a disabled id
//   offered(id, roomMode)                  the DIFFICULTIES whose official mode the version has for that room mode
//   modesOf(id, roomMode), laddered(…)     the official modes of that room mode in sortId order, and whether they are
//                                          more than one per difficulty (规程's solo: 规程等级 1–20 and 极速模拟) — such a
//                                          room keeps its mode id (server/lobby.js)
//   welcome()                              welcome.versions (DESIGN §35.23), or null when only act2autochess is enabled
//   file(cs16, rel)                        GET /cs/<cs16>/index.json and /cs/<cs16>/bounds/official.json of a version
//   servedDirs()                           the absolute data directories /data/versions/ may serve (static.js, buildTag)
//   stats()                                { enabled, default, loaded }
//   get(cs), dataBytes(cs)                 the match hosts' contents interface (server/match/host/index.js kind
//                                          'version'): the hash input, the bounds snapshot and the data bytes, read from
//                                          disk at each host start (the host checks every sha256 against the hash input)

import fs from 'node:fs';
import path from 'node:path';
import { DIFFICULTIES, modeIdFor } from '../shared/constants.js';
import { DEFAULT_VERSION, VERSIONS, versionById, versionSlug } from '../shared/versions.js';
import { canonicalJson, csUrlPart } from '../shared/plugins/identity.js';
import { officialBoundsOf } from '../shared/plugins/officialBounds.js';
import { DATA_DIR, VERSION_DATA_FILES, getData, loadData, versionDataDir } from './data.js';
import { contentIndexOf, nodeSha256, versionContentOf } from './plugins/identity.js';

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };
const JSON_TYPE = 'application/json; charset=utf-8';

/** @typedef {{ id: string, type: string, difficulty: string, name: string, code: string, sortId: number }} ModeInfo */

/**
 * The compact mode list of a config.json (the room modes the lobby offers; never the LOCAL tutorial), sortId order.
 * @param {any} config
 * @returns {ModeInfo[]}
 */
function modeInfoOf(config) {
  const modes = config?.modes && typeof config.modes === 'object' ? config.modes : {};
  return Object.entries(modes)
    .filter(([, m]) => m && (m.type === 'SINGLE' || m.type === 'MULTI'))
    .map(([id, m]) => ({ id, type: m.type, difficulty: m.difficulty, name: m.name, code: m.code ?? '', sortId: Number.isFinite(m.sortId) ? m.sortId : 0 }))
    .sort((a, b) => a.sortId - b.sortId || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The version service of one server (see the header).
 * @param {{ enabled: string[], defaultId?: string, dataDir?: string,
 *   vanilla: { cs: string, app: string, sim: string, simFiles: Record<string, string> },
 *   defaultData?: Readonly<Record<string, any>> | null, log?: { info?: Function, warn: Function, error?: Function } }} opts
 *   enabled / defaultId: versionsFrom's; dataDir: the server's data directory (versions/<slug>/ under it); vanilla: the
 *   server's vanilla content (server/plugins/identity.js); defaultData: the server's data (the default version's)
 */
export function createVersionSets({ enabled, defaultId = DEFAULT_VERSION, dataDir = DATA_DIR, vanilla, defaultData = null, log = noopLog }) {
  /** @type {Map<string, { entry: import('../shared/versions.js').OfficialVersion, dir: string, slug: string,
   *   content: NonNullable<ReturnType<typeof versionContentOf>>, modes: Set<string>, modeInfo: ModeInfo[], data?: any, bounds?: any,
   *   boundsBody?: Buffer, index?: Buffer }>} */
  const others = new Map();
  const wanted = VERSIONS.map((v) => v.id).filter((id) => enabled.includes(id));
  for (const id of wanted) {
    if (id === DEFAULT_VERSION) continue;
    const entry = versionById(id);
    const dir = versionDataDir(id, dataDir);
    if (!entry || !dir) continue;
    const slug = versionSlug(entry);
    let modes, modeInfo;
    try {
      const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      modes = new Set(Object.keys(config?.modes && typeof config.modes === 'object' ? config.modes : {}));
      modeInfo = modeInfoOf(config);
    } catch (e) {
      log.warn(`[versions] ${id} disabled: cannot read ${path.join(dir, 'config.json')} (${e?.code || e?.message || e})`);
      continue;
    }
    const content = versionContentOf({ vanilla, dataDir: dir, dataUrl: `/data/versions/${slug}/`, version: id, log });
    const missing = VERSION_DATA_FILES.filter((f) => !content?.data[f]);
    if (!content || missing.length) {
      log.warn(`[versions] ${id} disabled: ${content ? `${missing.map((f) => `${f}.json`).join(', ')} missing` : 'no data file'} in ${dir}`);
      continue;
    }
    others.set(id, { entry, dir, slug, content, modes, modeInfo });
  }
  const ids = wanted.filter((id) => id === DEFAULT_VERSION || others.has(id));
  if (!ids.length) ids.push(DEFAULT_VERSION);
  const def = ids.includes(defaultId) ? defaultId : ids[0];
  if (def !== defaultId) log.warn(`[versions] default version "${defaultId}" is not available, using ${def}`);
  const byCs = new Map([...others].map(([id, v]) => [v.content.cs, id]));
  const defaultModes = () => {
    const modes = (defaultData || getData())?.config?.modes;
    return new Set(Object.keys(modes && typeof modes === 'object' ? modes : {}));
  };
  /** The official modes of an enabled version of that room mode (sortId order), [] when it has no such rooms. */
  const modesOf = (id, roomMode) => {
    const entry = ids.includes(id) ? versionById(id) : null;
    if (!entry || !entry.roomModes.includes(roomMode)) return [];
    const info = id === DEFAULT_VERSION ? modeInfoOf((defaultData || getData())?.config) : /** @type {any} */ (others.get(id)).modeInfo;
    const type = roomMode === 'solo' ? 'SINGLE' : 'MULTI';
    return info.filter((m) => m.type === type);
  };
  const laddered = (id, roomMode) => modesOf(id, roomMode).some((m) => m.id !== modeIdFor(roomMode, m.difficulty));
  /** @type {Map<string, Readonly<Record<string, any>>>} */
  const contents = new Map();

  /**
   * The version's data, loaded once (deep-frozen by loadData). A load that throws or leaves a data file out (it passed the
   * boot checks: those hash the files and parse config.json only) is remembered: logged once, null from then on — the
   * 4.6–5.2 MB directory is never read again on the event loop at every room message.
   */
  const load = (id) => {
    const v = others.get(id);
    if (!v || v.failed) return null;
    if (!v.data) {
      try {
        const data = loadData(v.dir, { log: /** @type {any} */ (log), expected: VERSION_DATA_FILES });
        const missing = VERSION_DATA_FILES.filter((f) => !(f in data));
        if (missing.length) throw new Error(`${missing.map((f) => `${f}.json`).join(', ')} not loaded`);
        v.data = data;
      } catch (e) {
        v.failed = e;
        log.error(`[versions] ${id} data failed to load from ${v.dir} — unavailable until the server restarts`, e);
        return null;
      }
      log.info?.(`[versions] ${id} data loaded (${Object.keys(v.data).length} files)`);
    }
    return v.data;
  };
  /** Its official-bounds snapshot and the served body (canonical JSON); null when its data failed to load. */
  const boundsOf = (id) => {
    const v = others.get(id);
    if (!v) return null;
    if (!v.bounds) {
      const data = load(id);
      if (!data) return null;
      v.bounds = officialBoundsOf(data);
      v.boundsBody = Buffer.from(canonicalJson(v.bounds));
    }
    return v.bounds;
  };
  const indexOf = (id) => {
    const v = others.get(id);
    if (!v) return null;
    if (!v.index) {
      if (!boundsOf(id)) return null;
      const body = /** @type {Buffer} */ (v.boundsBody);
      const cs16 = csUrlPart(v.content.cs);
      v.index = Buffer.from(JSON.stringify(contentIndexOf(/** @type {any} */ (v.content), {
        dataUrl: v.content.dataUrl, version: id,
        bounds: { url: `/cs/${cs16}/bounds/official.json`, sha256: nodeSha256(body), bytes: body.length },
      })));
    }
    return v.index;
  };

  return {
    ids: Object.freeze(ids),
    defaultId: def,
    nonDefault: Object.freeze(ids.filter((id) => id !== DEFAULT_VERSION)),
    /** @param {unknown} id */
    isEnabled: (id) => typeof id === 'string' && ids.includes(id),
    /** Enabled, and (another version) its data loads — a failed load stays failed (see `load`). @param {unknown} id */
    available: (id) => typeof id === 'string' && ids.includes(id) && (id === DEFAULT_VERSION || load(id) != null),
    /** @param {unknown} id */
    entry: (id) => (typeof id === 'string' && ids.includes(id) ? versionById(id) : null),
    /** @param {string} id */
    csOf: (id) => (id === DEFAULT_VERSION ? (ids.includes(id) ? vanilla.cs : null) : others.get(id)?.content.cs ?? null),
    /** @param {string} cs */
    idOfCs: (cs) => (cs === vanilla.cs && ids.includes(DEFAULT_VERSION) ? DEFAULT_VERSION : byCs.get(cs) ?? null),
    /** @param {string} id */
    content(id) {
      if (!ids.includes(id)) return null;
      let c = contents.get(id);
      if (!c) {
        c = id === DEFAULT_VERSION
          ? Object.freeze({ cs: vanilla.cs, vanilla: true, plugins: Object.freeze([]) })
          : Object.freeze({ cs: /** @type {any} */ (others.get(id)).content.cs, vanilla: true, version: id, plugins: Object.freeze([]) });
        contents.set(id, c);
      }
      return c;
    },
    /** @param {string} id */
    data: (id) => (id === DEFAULT_VERSION ? (ids.includes(id) ? defaultData || getData() : null) : load(id)),
    /** @param {string} cs */
    dataOfCs(cs) {
      const id = cs === vanilla.cs && ids.includes(DEFAULT_VERSION) ? DEFAULT_VERSION : byCs.get(cs);
      return id ? (id === DEFAULT_VERSION ? defaultData || getData() : load(id)) : null;
    },
    /**
     * The difficulties the version offers a room mode (DIFFICULTIES order): those whose official mode is in its config.
     * @param {string} id @param {'solo' | 'coop'} roomMode
     * @returns {string[]}
     */
    offered(id, roomMode) {
      const entry = ids.includes(id) ? versionById(id) : null;
      if (!entry || !entry.roomModes.includes(roomMode)) return [];
      // a laddered room mode (规程's solo): the difficulties its modes have — mode_single_funny is 极速模拟 there, not 标准
      if (laddered(id, roomMode)) { const list = modesOf(id, roomMode); return DIFFICULTIES.filter((d) => list.some((m) => m.difficulty === d)); }
      const modes = id === DEFAULT_VERSION ? defaultModes() : /** @type {any} */ (others.get(id)).modes;
      return DIFFICULTIES.filter((d) => modes.has(modeIdFor(roomMode, d)));
    },
    /**
     * The official modes the version offers a room mode, in sortId order: { id, type, difficulty, name, code, sortId }.
     * @param {string} id @param {'solo' | 'coop'} roomMode
     * @returns {ModeInfo[]}
     */
    modesOf,
    /**
     * Does the version's room mode play more modes than one per difficulty (规程's solo ladder)? Its rooms keep their mode id.
     * @param {string} id @param {'solo' | 'coop'} roomMode
     */
    laddered,
    /**
     * welcome.versions, or null when the server offers act2autochess alone (that welcome carries no `versions`). A
     * version whose data failed to load is left out (no page could load it; known once a room or its manifest tried);
     * when that is the configured default, 第二期下半 (if enabled, else the first one left) is marked the default
     * instead, as the lobby's defaultVersion picks it.
     */
    welcome() {
      const live = ids.filter((id) => !others.get(id)?.failed);
      if (live.length === 1 && live[0] === DEFAULT_VERSION) return null;
      const shownDef = live.includes(def) ? def : live.includes(DEFAULT_VERSION) ? DEFAULT_VERSION : live[0];
      return live.map((id) => {
        const entry = /** @type {import('../shared/versions.js').OfficialVersion} */ (versionById(id));
        return { id, cs: id === DEFAULT_VERSION ? vanilla.cs : /** @type {any} */ (others.get(id)).content.cs, family: entry.family,
          label: entry.label, roomModes: [...entry.roomModes], ...(id === shownDef ? { default: true } : {}) };
      });
    },
    /**
     * /cs/<cs16>/index.json and /cs/<cs16>/bounds/official.json of an enabled non-default version, else null.
     * @param {string} cs16 @param {string} rel
     * @returns {{ body: Buffer, sha256: string, type: string } | null}
     */
    file(cs16, rel) {
      const id = [...others.keys()].find((k) => csUrlPart(/** @type {any} */ (others.get(k)).content.cs) === cs16);
      if (!id) return null;
      let body = null;
      if (rel === 'index.json') body = indexOf(id);
      else if (rel === 'bounds/official.json') { boundsOf(id); body = /** @type {any} */ (others.get(id)).boundsBody; }
      return body ? { body, sha256: nodeSha256(body), type: JSON_TYPE } : null;
    },
    /** The data directories of the enabled non-default versions (absolute). */
    servedDirs: () => [...others.values()].map((v) => path.resolve(v.dir)),
    stats: () => ({ enabled: [...ids], default: def, loaded: [...others.values()].filter((v) => v.data).length }),
    /**
     * The match hosts' view of a version (server/match/host/index.js, kind 'version'), else null.
     * @param {string} cs
     */
    get(cs) {
      const id = byCs.get(cs);
      if (!id) return null;
      const v = /** @type {any} */ (others.get(id));
      return {
        cs, name: id,
        hashInput: { app: v.content.app, sim: v.content.sim, data: Object.fromEntries(Object.entries(v.content.data).map(([k, f]) => [k, /** @type {any} */ (f).sha256])) },
        plugins: [], scripts: [], offers: [], bounds: boundsOf(id),
      };
    },
    /**
     * The bytes of every data file of a version, read from disk now (a host checks them against the hash input), else null.
     * @param {string} cs
     * @returns {Record<string, Buffer> | null}
     */
    dataBytes(cs) {
      const id = byCs.get(cs);
      if (!id) return null;
      const v = /** @type {any} */ (others.get(id));
      const out = {};
      for (const [name, f] of Object.entries(v.content.data)) {
        try { out[name] = fs.readFileSync(path.join(v.dir, /** @type {any} */ (f).file)); } catch (e) { log.warn(`[versions] cannot read ${id} ${/** @type {any} */ (f).file}: ${e?.code || e?.message || e}`); }
      }
      return out;
    },
  };
}
