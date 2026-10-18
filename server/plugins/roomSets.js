// server/plugins/roomSets.js — what a room's plugins make (DESIGN §32.6, P1c): the plugins a host switches on, of any
// class a room takes — cosmetic (art: a visual set named `vs`, server/plugins/visualSet.js — P1a) and content (gameplay: a
// content set named by its own `cs`, server/plugins/contentSets.js) — closed over their requirements and ordered as one
// list (shared/plugins/order.js), then split by class. The lobby (server/lobby.js setPlugins) asks it and holds what it
// answers:
//
//   resolve(ids, { scope, settings, replacing }) → { ok: true, set: { cs, vs?, plugins: [{ id, version, class, hash,
//     auto? }], warnings, bytes, dataBytes?, modes?, kitted? } } | { error, detail }
//     `cs` the content set's (a room with content plugins) or none (cosmetic plugins only: the room's cs stays the vanilla
//     one); `plugins` in load order; `warnings` the visual set's (override, app) plus `app` for a gameplay plugin made
//     for other game versions that the server owner lets through; `bytes` the art the set serves, `dataBytes` the patched
//     data files its members download beside the vanilla ones; `modes` the modes its content plugins provide; `kitted`
//     the operators a 自选 slot may field in the content set (the vanilla ones and its plugins' own).
//     Refused: PLUGIN_UNKNOWN (not installed), PLUGIN_BLOCKED (a class or scope a room cannot take in this version, or the
//     server owner's policy: rooms off / fixed, not in `allow`, the class off), PLUGIN_DEPENDENCY / PLUGIN_CONFLICT (the
//     load order), PLUGIN_INCOMPATIBLE (a gameplay plugin made for other game versions or another plugin API — unless
//     the policy allows it), PLUGIN_LIMIT (the visual set's art limits), PLUGIN_BUSY (one content set more than the
//     server runs at once).
//   hold / release (vs), holdContent / releaseContent (cs), onStale, unofficial — the visual and content sets'.
//   defaults() → the ids a new room starts with (the policy's `default`; [] for the original game); fixed() → those ids
//   when every room must play them (rooms: fixed), else null.
// A cosmetic plugin's requirements are cosmetic plugins (the visual set closes over them again) [ASSUMED]; a content
// plugin may require a cosmetic one (its operators' art) and may carry art itself (its `assets`: part of the room's
// visual set, so the room's `vs` names it too).

import { ERR } from '../../shared/constants.js';
import { normalizeSettings } from '../../shared/plugins/patch.js';
import { resolvePluginOrder } from '../../shared/plugins/order.js';

/**
 * @param {{ registry: { plugin: (id: string) => any, plugins?: () => any[] }, visual: ReturnType<typeof import('./visualSet.js').createVisualSets> | null,
 *   contents: ReturnType<typeof import('./contentSets.js').createContentSets> | null,
 *   policy: ReturnType<typeof import('./policy.js').createPluginPolicy> | null }} opts
 */
export function createRoomSets({ registry, visual, contents, policy }) {
  /** A content plugin a room may switch on: loaded, its data read (server/plugins/contentData.js; DESIGN §32.5), of the scope. */
  const contentUsable = (p, scope) => !!contents && !!p && ['content','script','trusted'].includes(p.class) && p.status === 'loaded' && !!p.content
    && Array.isArray(p.manifest?.scope) && p.manifest.scope.includes(scope);
  const cosmeticUsable = (p, scope) => !!visual && !!p && p.class === 'cosmetic' && p.status === 'loaded' && !!p.visual
    && Array.isArray(p.manifest?.scope) && p.manifest.scope.includes(scope);
  const allowed = (p) => !policy || policy.allows(p.id, p.class);

  /**
   * @param {string[]} ids
   * @param {{ scope?: 'room', settings?: Record<string, Record<string, unknown>>, replacing?: { cs?: string } | null }} [opts]
   */
  function resolve(ids, { scope = 'room', settings = {}, replacing = null } = {}) {
    const pol = policy?.get();
    if (pol && pol.rooms === 'off') return { error: ERR.PLUGIN_BLOCKED, detail: 'this server\'s rooms play the original game (plugins/config.json rooms: off)' };
    if (pol && pol.rooms === 'fixed') {
      const want = [...pol.default].sort().join(',');
      if ([...ids].sort().join(',') !== want) return { error: ERR.PLUGIN_BLOCKED, detail: 'this server fixes every room\'s plugins (plugins/config.json rooms: fixed)' };
    }
    for (const id of ids) {
      const p = registry.plugin(id);
      if (!p) return { error: ERR.PLUGIN_UNKNOWN, detail: `${String(id).slice(0, 40)} is not installed` };
      if (p.disabled) return {error:p.disabled.code,detail:`${id}: ${p.disabled.code}`};
      if (!cosmeticUsable(p, scope) && !contentUsable(p, scope)) return { error: ERR.PLUGIN_BLOCKED, detail: `${id} is not a cosmetic or content plugin of scope ${scope} this version loads` };
      if (!allowed(p)) return { error: ERR.PLUGIN_BLOCKED, detail: `${id} is not allowed on this server (plugins/config.json)` };
    }
    const lookup = (id) => {
      const p = registry.plugin(id);
      return p && (cosmeticUsable(p, scope) || contentUsable(p, scope)) && allowed(p) ? { id: p.id, ...p.manifest } : null;
    };
    const r = resolvePluginOrder(ids, lookup);
    if ('error' in r) return { error: ERR[r.error] || ERR.BAD_MSG, detail: r.detail };
    const entries = r.order.map((id) => registry.plugin(id));
    // the art: every cosmetic plugin, and a content plugin's own `assets` (its operators' art: the registry reads it as a
    // visual snapshot like a cosmetic plugin's; DESIGN §32.5) — one visual set
    const cosmeticIds = entries.filter((p) => p.class === 'cosmetic' || (['content','script','trusted'].includes(p.class) && p.visual)).map((p) => p.id);
    const contentIds = entries.filter((p) => ['content','script','trusted'].includes(p.class)).map((p) => p.id);
    const warnings = [];
    for (const p of entries) {
      if (!['content','script','trusted'].includes(p.class) || p.manifest.compatible !== false) continue;
      if (!pol?.allowIncompatible) return { error: ERR.PLUGIN_INCOMPATIBLE, detail: `${p.id} is made for ${p.manifest.app || 'other versions'} (api ${p.manifest.api ?? '?'})` };
      warnings.push({ code: 'app', params: { id: p.id, app: p.manifest.app } });
    }
    let vset = null;
    if (cosmeticIds.length) {
      const v = visual.resolve(cosmeticIds, { scope });
      if (!v || !v.ok) return v && v.error ? v : { error: ERR.INTERNAL, detail: 'the visual set failed' };
      vset = v.set;
    }
    let cset = null;
    if (contentIds.length) {
      const c = contents.resolve(contentIds, { settings, replacing: replacing?.cs ?? null });
      if (!c || !c.ok) return c && c.error ? c : { error: ERR.INTERNAL, detail: 'the content set failed' };
      cset = c.set;
    }
    const auto = new Set(r.auto);
    const vById = new Map((vset?.plugins || []).map((p) => [p.id, p]));
    const cById = new Map((cset?.plugins || []).map((p) => [p.id, p]));
    const plugins = entries.map((p) => {
      // a content plugin is named by its gameplay part (the content set's hash) even when it brings art too
      const src = ['content','script','trusted'].includes(p.class) ? cById.get(p.id) : vById.get(p.id);
      // (16 hex digits, as a cosmetic plugin's: the content set's plugin hash is a full SHA-256)
      const normalized = normalizeSettings(p.manifest.settings, settings[p.id]);
      return { id: p.id, version: p.manifest.version, class: p.class, ...(p.script ? { execution: cset?.execution } : {}), ...(Object.keys(normalized).length ? { settings: normalized } : {}), hash: String(src?.hash || '').slice(0, 16), ...(auto.has(p.id) ? { auto: true } : {}) };
    });
    return {
      ok: true,
      set: {
        ...(cset ? { cs: cset.cs } : {}),
        ...(vset ? { vs: vset.vs } : {}),
        plugins,
        ...(cset?.execution ? { execution: cset.execution } : {}),
        ...(cset?.scripts?.length && cset.execution !== 'sandbox' ? {trusted:{plugins:cset.scripts.map(({id,version,hash,permissions,authors}) => ({id,version,hash,permissions,authors}))}} : {}),
        warnings: [...(vset?.warnings || []), ...warnings],
        bytes: vset ? vset.bytes : 0,
        ...(cset ? { dataBytes: cset.dataBytes, modes: cset.modes, kitted: cset.kitted } : {}),
        ...(cset?.rules ? { rules: cset.rules } : {}),
      },
    };
  }

  return {
    resolve,
    hold: (vs) => visual?.hold?.(vs),
    release: (vs) => visual?.release?.(vs),
    holdContent: (cs) => contents?.hold?.(cs),
    releaseContent: (cs) => contents?.release?.(cs),
    onContentStale: (fn) => contents?.onStale?.(fn) || (() => {}),
    onStale: (fn) => (visual?.onStale ? visual.onStale(fn) : () => {}),
    unofficial: () => (visual?.unofficial ? visual.unofficial() : 0),
    // Catalogue hint only: language plugins can publish notices even when the unofficial count is zero.
    hasNotices: () => registry.plugins?.().some((p) => p.status === 'loaded' && p.manifest?.notices?.length > 0) || false,
    defaults: () => { const p = policy?.get(); return p && p.rooms !== 'off' ? [...p.default] : []; },
    /** The plugins every room must play (plugins/config.json rooms: fixed), else null. */
    fixed: () => { const p = policy?.get(); return p && p.rooms === 'fixed' ? [...p.default] : null; },
    /** The merged data of a content set (the lobby's checks of loadouts and 自选 picks in its rooms), or null. */
    dataOf: (cs) => contents?.dataOf?.(cs) || null,
    /** The operators a 自选 slot may field in a content set (null = the vanilla list). */
    kittedOf: (cs) => contents?.kittedOf?.(cs) || null,
    /** Content sets rooms hold now (/healthz content.sets). */
    contentInUse: () => contents?.inUse?.() || 0,
  };
}
