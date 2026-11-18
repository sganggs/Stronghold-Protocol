// tools/versions/act1autochess.mjs — build profile of 第一期下半: 盟约·上半 (act1autochess) in its final state V1_2
// (2025-11-25 → 2025-12-12; docs/DATA.md "Official versions (M0)", DESIGN §35.22). The master activity_table holds no pure
// 上半 any more: commit 12e0a020 (2026-03-10) migrated
// act1autochess to the 下半 schema and replaced the shared autoChessData, so every table is pinned to a commit of the
// season (Kengxxiao/ArknightsGameData, zh_CN/gamedata; cached in .cache/gamedata@<sha>/).
//   default 21b1f240 (2025-12-05, 上半 final): activity_table — its autochess sections are byte-identical to fdf34ff5 and
//           to every commit up to 3421eaff —, character / skill / uniequip / battle_equip, range_table (equal to the
//           range_table of dcc057f6, 2025-09-04) and the level files (levels/activities/act1autochess/* equal those of
//           23c99d5d, the V1_2 update)
//   enemy   ee2cabff (2025-12-05 17:15): enemy_handbook_table and enemy_database, the last change inside the season
// V1_2 opened on 11-25 with 23c99d5d; the 12-05 commit added 莎草's module, 娜斯提 to the owned 自选 pool, the ray / Mon3tr
// 自选 modules and 10 bond texts (DATA.md pins row), and changed three battle templates the build does not read. A split
// at 12-05 is open for the maintainer (DESIGN §35.22).
// M2 reads these rules and the per-version research. Other missing research still falls back to 第二期 [ASSUMED];
// the later measured draft/stock tables remain excluded. See docs/history/0.3.2.md §35.22.7.

export default Object.freeze({
  id: 'act1autochess',
  season: 'act1autochess',
  pins: Object.freeze({
    default: '21b1f240817dafe486653adda7a5085ff8a1ba17',
    enemy: 'ee2cabffd45de01548cc6dceb23129ce93ac7926',
  }),
  // 上半's bondInfoDict has activeType / isActiveInDeck instead of activeCondition; its 盟约·辅助干员 is a NORMAL row that
  // backs itself up (tools/versions/adapters.mjs)
  adapters: Object.freeze(['bondActiveType', 'selfBackupPreset']),
  research: 'docs/research/versions/act1autochess/',
  // the 下半-measured tables (shop stock overrides, the measured draft weights) are left out: uniform draws [ASSUMED]
  tables: Object.freeze({ stock: null, shopDraft: null, tacticDraft: null, bountyDrafts: null }),
  // 歌蕾蒂娅's garrison_39 names 斯卡蒂、幽灵鲨或安哲拉 here (下半: 深巡); 安哲拉 is shop chess chess_char_3_10
  pools: Object.freeze({ pool_chess_glady: Object.freeze(['char_263_skadi', 'char_143_ghost', 'char_218_cuttle']) }),
  config: Object.freeze({
    hiddenCore: Object.freeze({ single: 300, multi: 1000 }), // PRTS 卫戍协议：盟约: >300 / >1000 layers
    // Deploy order row by row from the bottom (PRTS 卫戍协议/帮助,
    // changed on 2026-03-14), a timed solo prep (300 s), no bench equipment, no boss shared by both
    // sides (news 5114). Full-bench swaps now follow the maintainer's round53 compatibility instruction in all
    // versions; exact first-period client fidelity is not independently re-measured [ASSUMED] (DESIGN §36.2).
    // Bonds greyed per match: 2 of the 6 core bonds — a guide written in the season (2025-12-09) says 「核心盟约ban2留4」
    // (community report via the owner, 2026-11-14, §37.205; 第二期's 3 of 8 had been assumed here); add-ons 4 of 9 as in
    // 第二期 [ASSUMED]; 标准 0 + 1 (research 01 A2: 上半's intro greys only 坚守).
    bans: Object.freeze({
      FUNNY: { core: 0, addon: 1 },
      NORMAL: { core: 2, addon: 4 }, HARD: { core: 2, addon: 4 }, ABYSS: { core: 2, addon: 4 },
      TRAINING: { core: 0, addon: 0 },
    }),
    rules: Object.freeze({ deployOrder: 'rowBottomUp', soloTimed: true, benchEquip: false, bossMirrorShare: false }),
  }),
  expect: Object.freeze({ bonds: 18, bands: 30, visibleNonDiy: 95, triggerDeviations: 'none' }),
});
