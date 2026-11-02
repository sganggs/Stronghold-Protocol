// tools/versions/act2autochess.mjs — build profile of the default version, 第二期下半: 盟约·下半 (act2autochess) in its
// final state V2_2 (docs/DATA.md "Official versions (M0)", DESIGN §35.22). It is today's build: the tables of
// Kengxxiao/ArknightsGameData at the pinned commits, the research in docs/research/, the 下半-measured tables of
// tools/build-data.mjs, and no config.version (test/versions-default-guard.test.js).
// Pinned since 2026-11-02 (DESIGN §37.91): master's activity_table lost the 盟约 season (CN 2.7.91, 卫戍协议·规程), so
// every file stays at CN 2.7.81 (the commit data/*.json was built from since 0.2.3) except the operator tables, which
// bring in the 2.7.91 operators and modules.

export default Object.freeze({
  id: 'act2autochess',
  season: 'act2autochess',
  pins: Object.freeze({
    default: '17759cc8cdf37388414145d16262a3a06f3ab25e',   // CN 2.7.81, 2026-10-08
    character: '08ba2aea0e8dba88eff0ec0d2c87e24b4db626f8', // CN 2.7.91, 2026-11-01: 冻河 / 国度 / 塔露拉, 4 modules
  }),
  adapters: Object.freeze([]),
  research: null,                // docs/research/
  tables: 'default',             // stock / shopDraft / tacticDraft / bountyDrafts as measured on 下半
  config: Object.freeze({ hiddenCore: Object.freeze({ single: 350, multi: 1200 }) }), // no rules: no config.version
  expect: Object.freeze({ bonds: 23, bands: 40, visibleNonDiy: 112, triggerDeviations: 'default' }),
});
