// Browser/Worker engine loader. Workers receive data and never fetch it (DESIGN §32.11).
export const SIM_DATA_FILES = Object.freeze(['chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'items', 'garrisons', 'bands', 'effects', 'backups']);

function deepFreeze(root) {
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (o === null || typeof o !== 'object' || Object.isFrozen(o)) continue;
    Object.freeze(o);
    for (const v of Object.values(o)) if (v !== null && typeof v === 'object') stack.push(v);
  }
  return root;
}

/**
 * Browser sim loader: the /sim/ modules + the data files (own frozen copies — the server's data is frozen too, so a
 * content bug that writes into a record fails identically on both sides). `raw` is that frozen data: the rehearsal
 * worker (battle/rehearsal.js) is handed the page's official copy once instead of fetching the files again. `data`
 * (DESIGN §32.6): the files of a room's content set the page checked (public/js/content.js) instead of fetching
 * /data/; `cs` names what was loaded; `bounds` its official-bounds snapshot (installSimBounds).
 */
let loadedScripts = false, loadedTraits = false, traitInstaller = null;
export async function loadBrowserSim({ base = '/sim/', dataBase = '/data/', fetchFn = (...a) => globalThis.fetch(...a), data = null, cs = null, bounds = null,
  scripts = [], hashInput = null, nativeVerified = false, deferScripts = false, traitRuntimeVerified = null } = {}) {
  const [spec, simdata, support] = await Promise.all([
    import(`${base}spec.js`), import(`${base}simdata.js`), import(`${base}content/support/index.js`),
  ]);
  const fetchOnce = async (n) => {
    try {
      const res = await fetchFn(`${dataBase}${n}.json`, { cache: 'no-cache' });
      return res && res.ok ? await res.json() : null;
    } catch { return null; }
  };
  // (a content set's data: structured copies, frozen below like downloaded files)
  const files = data ? SIM_DATA_FILES.map((n) => (data[n] && typeof data[n] === 'object' ? structuredClone(data[n]) : null))
    : await Promise.all(SIM_DATA_FILES.map(async (n) => (await fetchOnce(n)) ?? fetchOnce(n)));
  // a battle simulated without part of the data would still produce a plausible result the server accepts: never run
  // one — the loader fails (the next b.start retries it; meanwhile the server's deadline takes the field over)
  const missing = SIM_DATA_FILES.filter((n, i) => !files[i] || typeof files[i] !== 'object');
  if (missing.length) throw new Error(`simulation data unavailable: ${missing.join(', ')}`);
  const raw = {};
  SIM_DATA_FILES.forEach((n, i) => { raw[n] = deepFreeze(files[i]); });
  simdata.setSimData(raw);
  if (typeof support.setGameData === 'function') support.setGameData(null); // re-read through the injected data
  await installSimBounds(base, raw, data ? bounds : undefined);
  if (!deferScripts && scripts.length) {
    const sdkUrl = /^file:/i.test(base) ? new URL('../../shared/plugins/sdk.js',base).href : new URL('/shared/plugins/sdk.js',globalThis.location.href).href;
    const {loadScripts} = await import(new URL('scriptLoad.js',sdkUrl).href);
    await loadScripts(scripts,{hashInput,sdkUrl,extensionsUrl:base+'content/extensions.js',cs,nativeVerified});
  } else if (loadedScripts) (await import(base+'content/extensions.js')).resetExtensions();
  if (Object.values(raw.garrisons ?? {}).some(g => g.operatorTrait) || loadedTraits) {
    if (/^file:/i.test(base)) {
      const { installServerOperatorTraits } = await import(new URL('../../../server/plugins/operatorTraits.js', import.meta.url).href);
      await installServerOperatorTraits(raw, base);
    } else {
      const expected = traitRuntimeHash(raw);
      if (expected && traitRuntimeVerified !== expected) {
        if (deferScripts) throw new Error('operator trait runtime was not checked by the page');
        await checkOperatorTraitRuntime(raw, fetchFn);
      }
      if (!expected && traitInstaller) await traitInstaller(raw, base);
      else {
        const { installOperatorTraits } = await import(new URL('./operatorTraits.js?v=' + expected, import.meta.url).href);
        if (traitInstaller && traitInstaller !== installOperatorTraits) await traitInstaller({}, base);
        await installOperatorTraits(raw, base);
        traitInstaller = installOperatorTraits;
      }
    }
    loadedTraits = Object.values(raw.garrisons ?? {}).some(g => g.operatorTrait);
  }
  loadedScripts = !deferScripts && scripts.length > 0;
  return { spec, ds: new simdata.DataSource(raw, null), cs, raw };
}

/**
 * The official-bounds table of the engine's plugin caps (shared/plugins/officialBounds.js, DESIGN §32.5): the original
 * content's page scans the data it loaded (no request); a room's content set installs the snapshot its index lists
 * (public/js/content.js loads and checks it beside the data files) — the one the server validated against and its match
 * host installs too, so both simulate a modded battle with the same caps. A content set without one runs on the floor,
 * never on a scan of its own tables (a bomb would raise its own cap). `bounds` undefined: the original content.
 * @param {string} base @param {Record<string, any>} raw @param {any} [bounds]
 */
async function installSimBounds(base, raw, bounds) {
  let boundsMod;
  try {
    const spec = /^https?:|^file:/i.test(String(base))
      ? new URL('../../shared/plugins/officialBounds.js', base).href
      : '/shared/plugins/officialBounds.js';
    boundsMod = await import(spec);
  } catch { return; }
  if (bounds === undefined) boundsMod.rememberOfficialBounds(raw);
  else boundsMod.installOfficialBounds(bounds && bounds.v === 1 ? bounds : null);
}


function traitRuntimeHash(raw) {
  const hashes = Object.values(raw.garrisons ?? {}).filter(g => g.operatorTrait).map(g => g.operatorTrait.runtime);
  if (!hashes.length) return null;
  if (hashes.some(h => typeof h !== 'string' || !/^[a-f0-9]{64}$/.test(h) || h !== hashes[0])) throw new Error('operator trait runtime pins differ');
  return hashes[0];
}
/** Verify on the page; the simulation Worker's connect-src remains none. */
export async function checkOperatorTraitRuntime(raw, fetchFn = (...args) => globalThis.fetch(...args)) {
  const expected = traitRuntimeHash(raw);
  if (!expected) return null;
  const source = await fetchFn(new URL('./operatorTraits.js?v=' + expected, import.meta.url).href, { cache: 'no-cache' });
  if (!source?.ok) throw new Error('operator trait runtime unavailable');
  const { sha256Hex } = await import('../../../shared/sha256.js');
  if (sha256Hex(new Uint8Array(await source.arrayBuffer())) !== expected) throw new Error('operator trait runtime hash mismatch');
  return expected;
}
