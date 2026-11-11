// tools/versions/act3autochess-v3_1.mjs — build profile of 规程·序列Ⅰ: 「卫戍协议·规程」 (act3autochess), sequence Ⅰ (V3_1,
// open since 2026-11-08 16:00; PRTS 卫戍协议·规程: 修订期 from 2026-11-30 04:00, 序列Ⅱ later). The season's tables are
// activity.AUTOCHESS.act3autochess.V3_1 (no AUTOCHESS_SEASON entry any more) in the 下半 schema plus new tables (指令
// skills skillInfoDataDict, modeGroupDataDict, trainingData, seasonShop …).
// Kengxxiao/ArknightsGameData 6f63c14e (2026-11-09, CN data 79.2.0, change 127796 of 2026-11-05). Until Kengxxiao
// published that data version the files came from the ArknightsAssets/ArknightsGamedata mirror at b1031d10 (the same data
// version, normalised into Kengxxiao's shape by tools/versions/sources.mjs); the repin rebuilt every file byte-identically.
//
//   layout    'regulation': every player's field is in one scene, so the stage levels are atlases of three pieces and the
//             round templates the road only; tools/versions/layouts.mjs rebuilds the 盟约 19×21 levels from them
//   adapters  none: the bond and shop schemas are 下半's
//   research  docs/research/versions/act3autochess-v3_1/ — not written yet: every research file falls back to
//             docs/research/ (第二期下半) [ASSUMED] with a warning
//   tables    stock left out [ASSUMED] (no 规程 stock recording). shopDraft, tacticDraft and bountyDrafts are
//             tools/versions/tables/act3autochess-v3_1.mjs, measured on BV13LWM6BEvY (15 co-op 终极 matches,
//             2026-11-10/11). Each inference is marked [ASSUMED] in that module.
//   config    hiddenCore 350 / 1200 [ASSUMED] (下半's; PRTS 卫戍协议 says only 「满足特定条件」); bondDraw: solo chooses one of two core groups,
//             co-op greys half (owner 2026-11-09, official tutorial); add-on greys 5 of 16 in 险境+ and 2 of 10 below (recordings); rules.equipHand: separate 5-slot equipment row (maxDeckEquipmentChessCnt, 11-08 EQUIP_HAND map areas);
//             untimed solo
//             (PRTS: 独立模拟 各轮次决策时间无限), the merged leader-round HP of co-op (同盟模拟) and the rest are 下半's

export default Object.freeze({
  id: 'act3autochess@V3_1',
  season: 'act3autochess',
  section: Object.freeze(['AUTOCHESS', 'act3autochess', 'V3_1']),
  layout: 'regulation',
  pins: Object.freeze({
    default: '6f63c14e27b847ef74b53b00fe51fc322b3cd7ff', // Kengxxiao, 2026-11-09, CN data 79.2.0 (change 127796 of 2026-11-05)
  }),
  adapters: Object.freeze([]),
  research: 'docs/research/versions/act3autochess-v3_1/',
  tables: Object.freeze({
    stock: null,
    shopDraft: 'act3autochess-v3_1',
    tacticDraft: 'act3autochess-v3_1',
    bountyDrafts: 'act3autochess-v3_1',
  }),
  config: Object.freeze({
    hiddenCore: Object.freeze({ single: 350, multi: 1200 }),
    // Add-on bonds greyed per match, from official recordings (2026-11-12): co-op 终极 greys 5 of 16 in all 15 briefings of
    // BV13LWM6BEvY, solo 规程等级20 5 of 16 (BV12ZWP6pE7m), solo 规程等级1 2 of 10 (BV1fnWn6QEf9), solo 极速模拟 2 of 10
    // (BV1MyWn6TEBq). 险境 / 绝境 / 规程等级5–19 load the same 26 bonds as 终极: 5 [ASSUMED]; co-op 标准 and 规程等级2–4 load
    // the 18 of 极速 / 规程等级1: 2 [ASSUMED]; TRAINING none.
    bans: Object.freeze({
      FUNNY: { core: 0, addon: 2 }, FAST: { core: 0, addon: 2 },
      NORMAL: { core: 0, addon: 5 }, HARD: { core: 0, addon: 5 }, ABYSS: { core: 0, addon: 5 },
      TRAINING: { core: 0, addon: 0 },
    }),
    rules: Object.freeze({ equipHand: true, bondDraw: 'regulation' }),
  }),
  // 155 shop chess (310 records) and 465 effects against 下半's 133 / 361: 6.4 MB built, so the limit is 7 MB, not 6
  expect: Object.freeze({ bonds: 26, bands: 61, visibleNonDiy: 141, triggerDeviations: 'present', maxMB: 7 }),
});
