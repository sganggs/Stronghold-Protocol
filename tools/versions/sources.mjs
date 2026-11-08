// tools/versions/sources.mjs — where an official version's gamedata comes from (docs/DATA.md "Official versions (M0)").
// A profile reads Kengxxiao/ArknightsGameData unless it names another `source`: a mirror that publishes a data version
// Kengxxiao has not published yet. Its files are normalised on load into Kengxxiao's shape, which tools/build-data.mjs
// reads, so nothing downstream knows where a file came from.
//
//   kengxxiao        https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/<sha>/zh_CN/gamedata/, cached in
//                    .cache/gamedata@<sha>/ (the M0 pins)
//   arknightsassets  https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/<sha>/cn/gamedata/, cached in
//                    .cache/gamedata@aa-<sha>/. Decoded from the client's FlatBuffers, it differs from Kengxxiao in two
//                    ways (checked on b1031d10, CN data 79.2.0, against the 17759cc8 / 08ba2aea copies of the same files):
//                    an empty list — and a list or object Kengxxiao writes as null (a level's runes) — is written as {},
//                    and levels/enemydata/enemy_database.json is { <enemyId>: [levels…] } instead of
//                    { enemies: [{ Key, Value }] }. normalizeMirror undoes both.

/** The sources a profile may name (`source`, default 'kengxxiao'). */
export const SOURCES = Object.freeze({
  kengxxiao: Object.freeze({
    url: (sha) => `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${sha}/zh_CN/gamedata/`,
    cacheTag: (sha) => sha,
    mirror: false,
  }),
  arknightsassets: Object.freeze({
    url: (sha) => `https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/${sha}/cn/gamedata/`,
    cacheTag: (sha) => `aa-${sha}`,
    mirror: true,
  }),
});

/**
 * The source a profile reads its pinned files from.
 * @param {{ source?: string }} profile
 */
export function sourceOfProfile(profile) {
  const name = profile.source ?? 'kengxxiao';
  const src = SOURCES[name];
  if (!src) throw new Error(`unknown gamedata source ${JSON.stringify(name)} (known: ${Object.keys(SOURCES).join(', ')})`);
  return src;
}

const isEmptyObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0;

/**
 * Count, per key name and per key name at a depth, whether the key holds lists or objects. `withEmpty` counts empty
 * values and nulls too (a Kengxxiao file writes [], {} and null apart; a mirror file writes all three as {}, so only its
 * non-empty values tell).
 * @param {unknown} root
 * @param {boolean} withEmpty
 */
function keyKinds(root, withEmpty) {
  const byKey = new Map();
  const byDepth = new Map();
  const add = (map, k, kind) => { const s = map.get(k) || { arr: 0, obj: 0, nul: 0 }; s[kind]++; map.set(k, s); };
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object') return;
    const isArr = Array.isArray(node);
    for (const [k, v] of Object.entries(node)) {
      if (!isArr && v === null && withEmpty) {
        add(byKey, k, 'nul');
        add(byDepth, `${depth}:${k}`, 'nul');
      } else if (!isArr && v && typeof v === 'object') {
        const empty = Array.isArray(v) ? v.length === 0 : isEmptyObject(v);
        if (withEmpty || !empty) {
          const kind = Array.isArray(v) ? 'arr' : 'obj';
          add(byKey, k, kind);
          add(byDepth, `${depth}:${k}`, kind);
        }
      }
      walk(v, depth + 1);
    }
  };
  walk(root, 0);
  return { byKey, byDepth };
}

/** 'arr' / 'obj' when a count names one of the two only, 'nul' when it saw nulls only, else null. */
const decisive = (s) => (!s ? null : s.arr && !s.obj ? 'arr' : s.obj && !s.arr ? 'obj' : !s.arr && !s.obj && s.nul ? 'nul' : null);

/** 'arr' / 'obj' when two or more non-empty values of a parent are all lists or all objects, else null. */
function siblingKind(parent) {
  const s = { arr: 0, obj: 0 };
  for (const v of Object.values(parent)) {
    if (Array.isArray(v) ? v.length : v && typeof v === 'object' && !isEmptyObject(v)) s[Array.isArray(v) ? 'arr' : 'obj']++;
  }
  return s.arr + s.obj >= 2 ? decisive(s) : null;
}

/**
 * Turn a mirror file into Kengxxiao's shape, in place. Each {} becomes [] when the key holds lists. In an id-keyed table
 * (a parent stored under a key named …Dict / …Map, e.g. effectBuffInfoDataDict) its siblings decide first: an id names
 * different things in different tables (aceffect_band_7 is an object in effectInfoDataDict, a list here). Otherwise the
 * key decides: at the same depth elsewhere in the file, anywhere in the file, then in the reference files (the Kengxxiao
 * copies of the same tables at the default version's pins: a key they hold as null only becomes null); then the siblings
 * (two or more non-empty values of the same parent, all lists or all objects); then a key named …Dict / …Map stays an
 * object. A {} no rule decides stays as it is and is returned in `unresolved` (the build warns).
 * @param {string} rel path relative to the gamedata root (e.g. 'excel/activity_table.json')
 * @param {any} obj the parsed mirror file
 * @param {any[]} refs parsed reference files
 * @returns {{ obj: any, unresolved: string[] }}
 */
export function normalizeMirror(rel, obj, refs = []) {
  let root = obj;
  if (rel === 'levels/enemydata/enemy_database.json' && root && !Array.isArray(root.enemies)) {
    root = { enemies: Object.entries(root).map(([Key, Value]) => ({ Key, Value })) };
  }
  const own = keyKinds(root, false);
  const ref = { byKey: new Map(), byDepth: new Map() };
  for (const r of refs) {
    const k = keyKinds(r, true);
    for (const [name, map] of [['byKey', k.byKey], ['byDepth', k.byDepth]]) {
      for (const [key, s] of map) { const t = ref[name].get(key) || { arr: 0, obj: 0, nul: 0 }; t.arr += s.arr; t.obj += s.obj; t.nul += s.nul; ref[name].set(key, t); }
    }
  }
  const unresolved = [];
  const isTable = (name) => /(Dict|Map)$/.test(name);
  const kindOf = (k, depth, parent, parentKey) => (isTable(parentKey) ? siblingKind(parent) : null)
    ?? decisive(own.byDepth.get(`${depth}:${k}`)) ?? decisive(own.byKey.get(k))
    ?? decisive(ref.byDepth.get(`${depth}:${k}`)) ?? decisive(ref.byKey.get(k))
    ?? siblingKind(parent) ?? (isTable(k) ? 'obj' : null);
  const walk = (node, depth, path, nodeKey) => {
    if (!node || typeof node !== 'object') return;
    const isArr = Array.isArray(node);
    for (const [k, v] of Object.entries(node)) {
      if (!isArr && isEmptyObject(v)) {
        const kind = kindOf(k, depth, node, nodeKey);
        if (kind === 'arr') node[k] = [];
        else if (kind === 'nul') node[k] = null;
        else if (kind === null) unresolved.push(`${path}${k}`);
        continue;
      }
      walk(v, depth + 1, `${path}${k}.`, isArr ? nodeKey : k);
    }
  };
  walk(root, 0, '', '');
  return { obj: root, unresolved };
}
