// tools/versions/act1autochess-v1_1.mjs — build profile of 第一期上半: 盟约·上半 (act1autochess) in its first
// sub-version V1_1 (2025-11-14 16:00 → 2025-11-25 16:00), with the 11-18 hotfix (docs/DATA.md "Official versions (M0)";
// the maintainer's decisions of 2026-10-22, DESIGN §35.22). Pinned to Kengxxiao/ArknightsGameData:
//   default   8303c922 (the launch, data version 25-11-12-14-06-12): the range table, the enemy tables (enemy_database
//             changed again at 23c99d5d, so there is no separate enemy pin: V1_2's ee2cabff would leak V1_2 enemies) and
//             the 43 level files (the hotfix changed none; V1_2's 23c99d5d changed the three solo hidden-core levels
//             h08_0X_s, whose routes end at the 传送 entrance (1,3) instead of the protection point (2,2))
//   activity  ea164ef7 (the 11-18 hotfix, 25-11-17-12-07-19): activity_table with the first 20 strategies.
//             versionInfoDict counts the hotfix as V1_1 (V1_2 starts 2025-11-25 16:00) and 7 of V1_1's 11 days ran on
//             it. Its changes: leader HP ×0.75 (Funny / Normal pools, −5…−12.5% Hard), modeFactorInfo.SINGLE
//             1.0 → 1.25, borrowCount 8 → 20, the enemy effects 攻坚装备II / III, 战场 m06 weight 40 → 60, m07
//             weight 40 → 5 and Hard modes only (taken out of both Normal modes), 墨浪 / 枯朽萃聚使徒 special-enemy
//             weight 10 → 0, the leader weight of boss_2 (假想敌：铳) 5 → 2, 9 more enemies inactive in the Normal modes
//             (one of them, 沉沙 enemy_1207_sfji, also in the Funny modes), and 拟态物质's effectDesc (eff_acarm069
//             and the golden eff_acgarm069: 初始干员)
//   character ea164ef7: the hotfix also reworded skill_table's two sktok_acarm069 descriptions the same way, rows the
//             build does not read (the output is byte-identical with the character tables of 8303c922); character /
//             uniequip / battle_equip are the same at both commits. The client drag fix is not a build input.
// adapters: the two 上半 schema adapters, and launchMilestones: the table lists all 60 功勋 levels, and levels 36–60 open
// with V1_2 (availableTime 2025-11-25 16:00), so V1_1 has 35.
// The rest is as tools/versions/act1autochess.mjs.

export default Object.freeze({
  id: 'act1autochess@V1_1',
  season: 'act1autochess',
  pins: Object.freeze({
    default: '8303c922f749f0dcf08e03671519421ef6a7748b',
    activity: 'ea164ef70736ca2d1a356b3bf7b1cd7540960dc1',
    character: 'ea164ef70736ca2d1a356b3bf7b1cd7540960dc1',
  }),
  adapters: Object.freeze(['bondActiveType', 'selfBackupPreset', 'launchMilestones']),
  research: 'docs/research/versions/act1autochess-v1_1/',
  tables: Object.freeze({ stock: null, shopDraft: null, tacticDraft: null, bountyDrafts: null }),
  pools: Object.freeze({ pool_chess_glady: Object.freeze(['char_263_skadi', 'char_143_ghost', 'char_218_cuttle']) }),
  config: Object.freeze({
    hiddenCore: Object.freeze({ single: 300, multi: 1000 }),
    // Round53 authorizes full-bench swaps in every version; first-period client fidelity is unmeasured [ASSUMED], §36.2.
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
  expect: Object.freeze({ bonds: 18, bands: 20, visibleNonDiy: 95, triggerDeviations: 'none' }),
});
