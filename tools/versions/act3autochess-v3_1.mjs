// tools/versions/act3autochess-v3_1.mjs — build profile of 规程·序列Ⅰ: 「卫戍协议·规程」 (act3autochess), sequence Ⅰ (V3_1,
// open since 2026-11-08 16:00; PRTS 卫戍协议·规程: 修订期 from 2026-11-30 04:00, 序列Ⅱ later). The season's tables are
// activity.AUTOCHESS.act3autochess.V3_1 (no AUTOCHESS_SEASON entry any more) in the 下半 schema plus new tables (指令
// skills skillInfoDataDict, modeGroupDataDict, trainingData, seasonShop …).
// Kengxxiao/ArknightsGameData has not published the 11-05 data yet (last commit 08ba2aea, CN 2.7.91 of 2026-11-01, whose
// autoChessData is empty), so every file comes from the ArknightsAssets/ArknightsGamedata mirror at b1031d10 (2026-11-08,
// CN data 79.2.0, change 127796 of 2026-11-05), normalised into Kengxxiao's shape (tools/versions/sources.mjs). Repin to
// Kengxxiao once it publishes the same data version.
//
//   layout    'regulation': every player's field is in one scene, so the stage levels are atlases of three pieces and the
//             round templates the road only; tools/versions/layouts.mjs rebuilds the 盟约 19×21 levels from them
//   adapters  none: the bond and shop schemas are 下半's
//   research  docs/research/versions/act3autochess-v3_1/ — not written yet: every research file falls back to
//             docs/research/ (第二期下半) [ASSUMED] with a warning
//   tables    the 下半-measured stock / draft tables are left out: uniform draws [ASSUMED]
//   config    hiddenCore 350 / 1200 [ASSUMED] (下半's; PRTS 卫戍协议 says only 「满足特定条件」); bondDraw: solo chooses one of two core groups,
//             co-op greys half (owner 2026-11-09, official tutorial); add-on counts borrow 盟约 [ASSUMED]; rules.equipHand: separate 5-slot equipment row (maxDeckEquipmentChessCnt, 11-08 EQUIP_HAND map areas);
//             untimed solo
//             (PRTS: 独立模拟 各轮次决策时间无限), the merged leader-round HP of co-op (同盟模拟) and the rest are 下半's

export default Object.freeze({
  id: 'act3autochess@V3_1',
  season: 'act3autochess',
  section: Object.freeze(['AUTOCHESS', 'act3autochess', 'V3_1']),
  source: 'arknightsassets',
  layout: 'regulation',
  pins: Object.freeze({
    default: 'b1031d1035e8df3042f601e33d5c1dfab8345d59', // ArknightsAssets/ArknightsGamedata, 2026-11-08, CN data 79.2.0
  }),
  adapters: Object.freeze([]),
  research: 'docs/research/versions/act3autochess-v3_1/',
  tables: Object.freeze({ stock: null, shopDraft: null, tacticDraft: null, bountyDrafts: null }),
  config: Object.freeze({
    hiddenCore: Object.freeze({ single: 350, multi: 1200 }),
    // [ASSUMED] Add-on counts pending official measurement; FAST follows FUNNY, TRAINING draws none.
    bans: Object.freeze({
      FUNNY: { core: 0, addon: 1 }, FAST: { core: 0, addon: 1 },
      NORMAL: { core: 0, addon: 4 }, HARD: { core: 0, addon: 4 }, ABYSS: { core: 0, addon: 4 },
      TRAINING: { core: 0, addon: 0 },
    }),
    rules: Object.freeze({ equipHand: true, bondDraw: 'regulation' }),
  }),
  // 155 shop chess (310 records) and 465 effects against 下半's 133 / 361: 6.4 MB built, so the limit is 7 MB, not 6
  expect: Object.freeze({ bonds: 26, bands: 61, visibleNonDiy: 141, triggerDeviations: 'present', maxMB: 7 }),
});
