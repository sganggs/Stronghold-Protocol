// sp:sdk@1 facade. Imported only by a script content realm (never on the vanilla loading path).
// URL/import.meta are supplied by both ESM hosts; the shared checkJs slice intentionally has no DOM/Node lib.
const URL = /** @type {any} */ (globalThis).URL;
const moduleUrl = /** @type {any} */ (import.meta).url;
const root = new URL('../../', moduleUrl);
const sim = new URL(root.protocol === 'file:' ? 'server/sim/' : 'sim/', root);
const [helpers, deterministic, values, extensions, directions, targets] = await Promise.all([
  import(new URL('content/kits/shared/tier1.js', sim).href), import(new URL('detmath.js',sim).href),
  import(new URL('constants.js',sim).href), import(new URL('content/extensions.js',sim).href),
  import(new URL('dir.js',sim).href), import(new URL('targeting.js',sim).href),
]);
const freeze = v => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { for (const x of Object.values(v)) freeze(x); Object.freeze(v); }
  return v;
};
// SDK-owned records are immutable copies. Never recursively freeze Battle/Unit, hook handles or callback inputs.
const recordHelpers = new Set(['talentBb','talentGrid','moduleBb','traitBb','skillRec','skillBbOf']);
const listHelpers = new Set(['enemiesInGrid','alliesInGridOf']);
const copyRecord = v => v && typeof v === 'object'
  ? Object.freeze(Array.isArray(v) ? v.map(copyRecord) : Object.fromEntries(Object.entries(v).map(([k,x]) => [k,copyRecord(x)]))) : v;
/** Stable tier1 subset: num, talentBb, talentGrid, moduleBb, traitBb, moduleOn, up, cheb,
 * isMainHit, byEnemyAttack, skillBusy, giveSp, onHitBy, onHitOn, onDamagedOn, enemiesInGrid,
 * alliesInGridOf, enemyInRange, statBuff, toggleBuff, instantKind, skillRec, skillBbOf, batMod.
 * Hooks and engine helpers follow SIM §5–7. No ambient IO, storage, clocks or randomness is supplied.
 */
export const kit = Object.freeze(Object.fromEntries(('num talentBb talentGrid moduleBb traitBb moduleOn up cheb '+
  'isMainHit byEnemyAttack skillBusy giveSp onHitBy onHitOn onDamagedOn enemiesInGrid alliesInGridOf enemyInRange '+
  'statBuff toggleBuff instantKind skillRec skillBbOf batMod').split(' ').map(k => [k,
  recordHelpers.has(k) ? (...args) => copyRecord(helpers[k](...args))
    : listHelpers.has(k) ? (...args) => Object.freeze([...helpers[k](...args)]) : helpers[k]])));
export const math = Object.freeze({...deterministic});
export const constants = freeze({...values});
/** Pure geometry only: no Battle/Unit capability or mutable engine record crosses this facade. */
export const dir = Object.freeze({ dirVec: directions.dirVec, offsetTile: (...args) => Object.freeze(directions.offsetTile(...args)) });
export const targeting = Object.freeze({ absoluteRangeKeys: (grid, r, c, facing, extend = 0) => {
  // [ASSUMED] Match the compact grid cap; no battle-state access or engine-action budget charge.
  if (Array.isArray(grid) && grid.length > 1024) throw new RangeError('absoluteRangeKeys: at most 1024 cells');
  return Object.freeze(targets.absoluteRangeKeys(grid, r, c, facing, extend));
} });
/** A setup-scoped SDK; settings copied/frozen; logging capped at 20 lines per setup [ASSUMED]. */
export function createSDK(plugin, { settings = {}, log = (..._args) => {} } = {}) {
  let lines = 0;
  const need = permission => {
    if (plugin.permissions && !plugin.permissions.includes(permission)) throw Object.assign(new Error(`${plugin.id}: ${permission} required`),{code:'PLUGIN_PERMISSION_MISSING'});
  };
  return Object.freeze({ kit, math, constants, dir, targeting, settings: freeze(JSON.parse(JSON.stringify(settings))),
    kits: Object.freeze({ register: (id,fn) => {need('sim.code');return extensions.registerKit(plugin,id,fn);} }),
    enemies: Object.freeze({ register: (id,fn) => {need('sim.code');return extensions.registerEnemy(plugin,id,fn);} }),
    content: Object.freeze({ register: mod => {if(mod.install)need('sim.code');if(mod.registerMeta)need('meta.code');return extensions.registerContent(plugin,mod);} }),
    meta: Object.freeze({ register: (id,h) => {need('meta.code');return extensions.registerMeta(plugin,id,h);} }),
    log: (...args) => { if (lines++ < 20) log(`[plugin:${plugin.id}]`, ...args.map(x => String(x).slice(0,500))); },
  });
}

/** The module id a plugin's code imports (the frozen API table, docs/PLUGIN-API.md). */
export const SDK_ID = 'sp:sdk@1';
/** What createSDK(plugin) hands a plugin's setup as `sp` — each one is a row of the frozen API table. */
export const SDK_MEMBERS = Object.freeze(['constants', 'content.register', 'dir', 'enemies.register', 'kit', 'kits.register', 'log', 'math', 'meta.register', 'settings', 'targeting']);
