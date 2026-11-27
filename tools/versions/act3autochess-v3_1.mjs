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
//   tables    stock: six per-item equipment caps from the pool test BV1QV1czHE9o, no operator exceptions (§37.357). shopDraft, tacticDraft and bountyDrafts are
//             tools/versions/tables/act3autochess-v3_1.mjs, measured on BV13LWM6BEvY (15 co-op 终极 matches,
//             2026-11-10/11). Each inference is marked [ASSUMED] in that module.
//   config    hiddenCore 350 / 1200 [ASSUMED] (下半's; PRTS 卫戍协议 says only 「满足特定条件」); bondDraw: solo chooses one of two core groups,
//             co-op greys half (owner 2026-11-09, official tutorial); add-on greys 5 of 16 in 险境+ and 2 of 10 below (recordings); rules.equipHand: separate 5-slot equipment row (maxDeckEquipmentChessCnt, 11-08 EQUIP_HAND map areas);
//             untimed solo
//             (PRTS: 独立模拟 各轮次决策时间无限), the merged leader-round HP of co-op (同盟模拟) and the rest are 下半's

const SPECIAL_HAMMERS = Object.freeze(['eff_acarm045', 'eff_acarm043', 'eff_acarm044', 'eff_acarm042', 'eff_acarm140']);

// One entry per round. null = that round adds no global_effect (the cumulative scale carries forward).
const roundEffects = (ids) => Object.freeze(ids.map((id) => (id == null ? null : 'aceffect_enemy_' + id)));

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
    // Per-item equipment caps from the community pool test BV1QV1czHE9o (1:20–1:34, 2026-11-24, 规程等级5; §37.357):
    // 简易通讯机 5; 蜂鸣器, 动能单手弩, 汲取者之喙, 驱逐者警棍 6; 寻呼模块 7; every other item keeps its tier's copies
    // (伪装服 8 in 规程, not 下半's 7). No operator exceptions (0:45–0:55: every operator has its tier's copies).
    stock: Object.freeze({
      chess: Object.freeze({}),
      items: Object.freeze({ 简易通讯机: 5, 蜂鸣器: 6, 动能单手弩: 6, 汲取者之喙: 6, 驱逐者警棍: 6, 寻呼模块: 7 }),
    }),
    shopDraft: 'act3autochess-v3_1',
    tacticDraft: 'act3autochess-v3_1',
    bountyDrafts: 'act3autochess-v3_1',
  }),
  // garrison_61 names 幽灵鲨、安哲拉、深巡或斯卡蒂. The shared default is 下半's three (深巡, no 安哲拉).
  pools: Object.freeze({
    pool_chess_glady: Object.freeze(['char_263_skadi', 'char_143_ghost', 'char_4137_udflow', 'char_218_cuttle']),
  }),
  // Pool members follow this season's official trait/bond text. Exact server-side weights are unpublished:
  // [ASSUMED] 小概率 = 10% total, split equally within the common/rare category; specials are uniform.
  equipmentPools: Object.freeze({
    pool_equip_kathe_0: { weighted: [['eff_acarm041', 90], ...SPECIAL_HAMMERS.map(e => [e, 2])], assumed: true },
    pool_equip_rockr: { weighted: [...SPECIAL_HAMMERS.map(e => [e, 18]), ['eff_acarm155', 10]], assumed: true },
    pool_equip_vict: { items: SPECIAL_HAMMERS, assumed: true },
    pool_equip_pasngr: { weighted: [['eff_acarm066', 45], ['eff_acarm050', 45], ['eff_acarm069', 10]], assumed: true },
    pool_equip_kjeragbond2: { items: ['eff_acarm062'] },
  }),

  // Official recording BV1FVWN6VEAr 01:15–01:19: a normal communicator on normal Ironhide recruits it at shop II.
  // Only the carrier's own special copy is admitted; this does not relax every hidden operator or recruitment effect.
  // [ASSUMED] Advanced communicators and elite carriers use the same exception; the recording verifies normal on normal only.
  recruitTierExempt: Object.freeze(['chess_char_5_22_a']),
  config: Object.freeze({
    // Per-round added aceffect_enemy_* . 终极: one new global_effect per round in two CN co-op matches on
    // 2026-11-25 (m06 / m11), §37.353. 绝境 / 险境 / 标准: the same public spawn preview
    // (https://www.lubiao.wiki/tools/garrison-spawn-preview, data script https://www.lubiao.wiki/_nuxt/DQTTtovG.js,
    // key seq1). That file's covenant-lower.mode_multi_abyss matches 下半 co-op 终极 in data/config.json (research 01
    // A3) on ATK, HP and move speed for all 15 rounds. [ASSUMED] each list applies on every battlefield of that
    // co-op mode. Solo stays on 下半's stack counts: the preview has no solo list. Solo 规程等级15–20 share
    // level_event_1 with co-op 险境/标准, while 绝境 and 终极 both use level_event_2 and still differ, so the event
    // id does not give a solo list. 标准 is 14 rounds in the preview (no hidden round).
    enemyRoundEffects: Object.freeze({
      mode_multi_abyss: roundEffects(['8', '6', '1', '7', '2_2', '7', '7', '9', '16', '2_2', '8', '10', '15', '7', '2_2']),
      mode_multi_hard: roundEffects(['7', '7', null, '7', '2_2', '7', '7', null, '2_2', '2_2', '7', '2_3', '21', '21', '2']),
      mode_multi_normal: roundEffects(['4', '7', null, '7', '2', '2', '12', '14', '13', '2', '13', '13', '20', null, '2']),
      mode_multi_funny: roundEffects(['4', '2', null, null, null, '2', null, null, null, null, null, '3', null, null]),
    }),
    hiddenCore: Object.freeze({ single: 350, multi: 1200 }),
    // Bonds greyed per match, from official recordings (2026-11-12). Add-ons: co-op 终极 greys 5 of 16 in all 15 briefings
    // of BV13LWM6BEvY, 险境 and 绝境 5 of 16 and 标准 2 of 10 (BV11NW869ELq parts 3–5, 10), solo 规程等级20 5 of 16
    // (BV12ZWP6pE7m), solo 规程等级1 2 of 10 (BV1fnWn6QEf9), solo 极速模拟 2 of 10 (BV1MyWn6TEBq); 规程等级2–19 follow
    // their difficulty [ASSUMED]; TRAINING none. Core (co-op only; solo chooses one of two groups of half the core
    // bonds instead): 标准 0 of 8 (two matches), 险境 / 绝境 / 终极 5 of 10.
    bans: Object.freeze({
      FUNNY: { core: 0, addon: 2 }, FAST: { core: 0, addon: 2 },
      NORMAL: { core: 5, addon: 5 }, HARD: { core: 5, addon: 5 }, ABYSS: { core: 5, addon: 5 },
      TRAINING: { core: 0, addon: 0 },
    }),
    rules: Object.freeze({ equipHand: true, bondDraw: 'regulation' }),
    // Boss and hidden fields keep permanent IN_BATTLE layer gains (maintainer 2026-11-19). 联防 stays off.
    // Omitted on the covenant profiles, so their built config.finalAssault.layerGainsEnabled stays false.
    finalAssault: Object.freeze({ layerGainsEnabled: true }),
    // Income per round, read at every prep start on official recordings (round 84; the round-start banner 「获得 +X」
    // equals the counter): base min(3 + round, 11) — R1–R8 4…11, R9 on 11 — on BV1fnWn6QEf9 (solo 规程等级1, all 14
    // rounds, no extra source), BV12ZWP6pE7m (规程等级20) and BV13LWM6BEvY p1 / p8 (co-op 终极); 极速模拟 min(5 + round,
    // 11) on BV1MyWn6TEBq (one match, R1 6 … R6–R9 11). 下半's cap 12 was never measured past R3.
    economy: Object.freeze({ incomeBase: 3, incomeCap: 11, modeIncome: Object.freeze({ mode_single_funny: Object.freeze({ base: 5, cap: 11 }) }) }),
  }),
  // 155 shop chess (310 records) and 465 effects against 下半's 133 / 361: 6.4 MB built, so the limit is 7 MB, not 6
  expect: Object.freeze({ bonds: 26, bands: 61, visibleNonDiy: 141, triggerDeviations: 'present', maxMB: 7 }),
});
