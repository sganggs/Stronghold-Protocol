// tools/versions/act2autochess-v2_1.mjs — build profile of 第二期上半: 盟约·下半 (act2autochess) in its first sub-version
// V2_1 (2026-03-14 16:00 → 2026-03-27 16:00, the 更新#2 that made V2_2, today's data; docs/DATA.md "Official versions
// (M0)", the maintainer's decisions of 2026-10-22, DESIGN §35.22). Every table is pinned to the launch commit 1457587e
// (Kengxxiao/ArknightsGameData, data version 26-03-13-06-11-47): activity_table (36 strategies, 120 chess), the
// character / skill / module / range tables, enemy_handbook_table and enemy_database, and the level files of both
// seasons with level_autochess_enemy_data (levels changed next at a24a8ad1, 2026-04-08). No file the build reads
// changed between 1457587e and 86b6e749 (V2_2): the GitHub history of each path, checked 2026-10-22; range, uniequip,
// battle_equip and enemy_database last changed at 12e0a020 (2026-03-10), so their 1457587e copy is also V2_1's.
// 987b4cd5 (03-17) changed only battle/buff_template_data.json (精准's ATK and five flags), not a build input: 第二期上半
// stands for V2_1 with that fix [ASSUMED]; 03-17 vs 03-27 is open for the maintainer (DESIGN §35.22).
//
// What carries over from the default build (same season, measured on V2_2) and what does not:
//   adapters  launchModes: the 1457587e table already lists the 终极 modes (startTime 2026-03-27 16:00); they open with
//             V2_2 and are left out. launchMilestones: so do 功勋 levels 36–60 (availableTime 2026-03-27 16:00), so V2_1
//             has 35. The bond and shop schemas are 下半's, so the 上半 adapters do not apply.
//   research  docs/research/ by id [ASSUMED]: the bond specs (02, by bondId), the item kinds (04, by trapId), the enemy
//             and stage notes (05, by id), the asset notes (07) and the core numbers (01: the enemy stat multipliers per
//             mode and round, PRTS 下半, and the trophies), all written on V2_2; the build warns of none missing.
//   tables    'default' [ASSUMED]: the 机变 events (effectChoiceInfoDict) and the shop rows (trapShopChessDatas) are
//             byte-identical at 1457587e and today, the bounty cards keep their ids and draft data (one text, 悬赏·折射II,
//             changed on 04-14); the measured stock (BV1eLXXBqEgF, 2026-03-29)
//             and the 22 matches of test/fixtures/official-bounty-drafts.json (dated to the end of March 2026, so V2_1 or
//             V2_2) name only operators and items V2_1 has (stockByName / itemByName throw otherwise).
//   config    hiddenCore 350 / 1200 [ASSUMED] (PRTS 卫戍协议：盟约 下半; its 3-27 notes do not change them); rules {}:
//             every 下半 rule switch dates from 2026-03-14 (news 5114: untimed solo, bench equipment and full-bench swap,
//             the shared boss; PRTS 卫戍协议/帮助: the deploy order), so V2_1 runs on the default's rules.
//   expect    the deliberate trigger deviations (DESIGN §21.29) apply to the operators V2_1 has ('present'): 雷蛇
//             (char_107_liskam) joined with V2_2. 36 strategies, 120 chess (119 visible with the 4 DIY slots).

export default Object.freeze({
  id: 'act2autochess@V2_1',
  season: 'act2autochess',
  pins: Object.freeze({
    default: '1457587e48fe65361f523821d24e6d14c3b91713',
  }),
  adapters: Object.freeze(['launchModes', 'launchMilestones']),
  research: 'docs/research/versions/act2autochess-v2_1/',
  tables: 'default',
  config: Object.freeze({
    hiddenCore: Object.freeze({ single: 350, multi: 1200 }),
    rules: Object.freeze({}),
  }),
  expect: Object.freeze({ bonds: 23, bands: 36, visibleNonDiy: 115, triggerDeviations: 'present' }),
});
