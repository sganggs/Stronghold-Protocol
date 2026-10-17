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
 * /data/; `cs` names what was loaded; `bounds` its official-bounds snapshot (installSimBounds). `reuse(name)`: a file
 * of the original content the page already parsed (public/js/data.js `getRaw` — the match UI has ten of the eleven),
 * adopted instead of fetched and parsed again.
 */
let loadedScripts = false;
export async function loadBrowserSim({ base = '/sim/', dataBase = '/data/', fetchFn = (...a) => globalThis.fetch(...a), data = null, cs = null, bounds = null,
  scripts = [], hashInput = null, nativeVerified = false, deferScripts = false, reuse = null } = {}) {
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
  // `reuse(name)`: a file the page already parsed (public/js/data.js — the match UI loads ten of these eleven on entering
  // a room), adopted as it is instead of fetched and parsed a second time — one object graph per page instead of two
  // (about 9 MiB of heap and a 5 MB parse at the first battle). The adopted copies are the page's own objects; the
  // `deepFreeze` below is what keeps the sim's guarantee (a content bug that writes into a record fails here too).
  const files = data ? SIM_DATA_FILES.map((n) => (data[n] && typeof data[n] === 'object' ? structuredClone(data[n]) : null))
    : await Promise.all(SIM_DATA_FILES.map(async (n) => {
      const local = reuse ? reuse(n) : null;
      if (local && typeof local === 'object') return local;
      return (await fetchOnce(n)) ?? fetchOnce(n);
    }));
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

