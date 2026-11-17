// 规程 机变 draft tables, measured on 15 co-op 终极 matches (BV13LWM6BEvY, 2026-11-10/11; the readings are
// test/fixtures/official-regulation-drafts.json). Same shapes as the 下半 constants in tools/build-data.mjs
// (BOUNTY_INITIAL_SETS / BOUNTY_BOSS_GROUPS / BOUNTY_HUNTER_GROUPS / SHOP_DRAFT / TACTIC_DRAFT): a group is
// { cards, seen } or { cards, hits, seen, open? }, and the build turns `hits` into weights 1 + hits.
// choices.js is unchanged. A list of 7 shows 6 (drawWeighted). A hunter group that already holds two tier-III
// cards keeps both: hunterFill adds a giant only when the list has none. An initial group has no `open`, so a
// list seen once is stored as the 6 cards on the screen.
//
// Every line marked [ASSUMED] is an inference the 15 screens do not settle.

const EE = (s) => `enemyeffect_${s}`;

/**
 * R3 (enemy_initial_1..10). Seven lists seen, so three of the ten events are built by `initialRule`.
 * Series 17 / 18 and the two mixed lists are 7 cards and the screen shows 6. Series 19 is the whole catalog
 * (19_1..19_6; there is no 19_7) and the same 6 cards came in all 4 matches. Match 1 and match 13 are not a
 * 6-subset of any other list.
 */
export const bountyDrafts = {
  initialSets: [
    { cards: ['17_1', '17_2', '17_3', '17_4', '17_5', '17_6', '17_7'].map(EE), seen: [2, 8] },
    { cards: ['19_1', '19_2', '19_3', '19_4', '19_5', '19_6'].map(EE), seen: [4, 5, 6, 15] },
    { cards: ['18_1', '18_2', '18_3', '18_4', '18_5', '18_6', '18_7'].map(EE), seen: [12, 14] },
    { cards: ['10_5', '11_4', '11_5', '12_5', '13_6', '15_4', '20_3'].map(EE), seen: [3, 9] },
    { cards: ['12_4', '12_9', '13_4', '14_6', '15_4', '18_7', '20_4'].map(EE), seen: [7, 10, 11] },
    // [ASSUMED] the 6 cards on the screen. Initial drafts have no `open`, and no second draw revealed a 7th.
    { cards: ['12_5', '20_5', '10_4', '20_1', '11_4', '13_9'].map(EE), seen: [1] },
    { cards: ['15_5', '12_9', '13_4', '17_7', '10_6', '14_5'].map(EE), seen: [13] },
  ],
  // [ASSUMED] the 3 unseen events. tiers I I I II II III III is the pattern of the complete lists of 7
  // (series 17, series 18, and the 12_4 set); series 19 is 6 only because the catalog has 6, and the 10_5 set
  // is the one list with a single III. perSeries 2 because those mixed lists hold two of series 11, 12 or 20.
  // series is the mixed-list series: 17 / 18 / 19 are already whole seen lists. prefer is the tier-III initial
  // cards no screen showed (11_6, 12_6, 15_6, 20_6), so both III slots of an unseen list come from them.
  initialRule: {
    series: [10, 11, 12, 13, 14, 15, 20],
    tiers: [1, 1, 1, 2, 2, 3, 3],
    perSeries: 2,
    prefer: ['11_6', '12_6', '15_6', '20_6'].map(EE),
  },
  // R9 (bossInitial_1..6). One group per event, picked by how many matches it came in (`pick: 'seen'`), not by
  // the leader: matches 4 and 8 are both 假想敌：胄 and they are different groups. A card shared by two groups
  // is kept in both (下半 does the same). 腐败骑士 b_5, “遗弃者” b_7 and 锏 b_15 never appeared.
  bossGroups: [
    // 鼠王. The three drafts together are exactly these 9 cards.
    { cards: ['5_1', 'b_10', 'b_11', 'b_13', 'b_3', 'b_9', 'b_1', 'b_14', 'b_23'].map(EE), hits: [2, 2, 2, 2, 3, 2, 2, 2, 1], seen: [2, 8, 10] },
    // 扎罗 + 迷路的巨像. Each draft leaves out a different one of the 7. No W and no 碎骨: a shared base is not invented.
    { cards: ['5_1', 'b_13', 'b_16', 'b_18', 'b_2', 'b_9', 'b_3'].map(EE), hits: [2, 2, 2, 2, 2, 1, 1], seen: [4, 7] },
    // “墓碑” + “巨大的丑东西” + 凋零骑士. 8 cards across 4 drafts.
    { cards: ['5_1', 'b_1', 'b_13', 'b_17', 'b_20', 'b_6', 'b_10', 'b_3'].map(EE), hits: [2, 4, 4, 3, 4, 2, 3, 2], seen: [5, 11, 12, 13] },
    // 喷气人 + 纠缠藤蔓 + 泥岩 + “庞贝” + 澪. Matches 3, 14 and 15 share these bosses and the union is exactly 9.
    { cards: ['5_1', 'b_19', 'b_13', 'b_10', 'b_3', 'b_4', 'b_24', 'b_8', 'b_12'].map(EE), hits: [2, 2, 2, 3, 2, 2, 2, 2, 1], seen: [3, 14, 15] },
    // [ASSUMED] “复仇者” + “邪魔的利刃” together with match 9. The two drafts share 4 of 6 cards, and 6 groups
    // then match the 6 bossInitial events. Leaving them apart would be 7 groups for 6 events.
    { cards: ['5_1', 'b_19', 'b_2', 'b_21', 'b_22', 'b_3', 'b_1', 'b_10'].map(EE), hits: [2, 2, 2, 1, 1, 2, 1, 1], seen: [1, 9] },
    // [ASSUMED] match 6, the 6 cards on the screen. It is not a subset of the 鼠王 or 扎罗 group, and no second
    // draft revealed a 7th, so W is not invented onto it.
    { cards: ['5_1', 'b_1', 'b_13', 'b_2', 'b_3', 'b_9'].map(EE), hits: [1, 1, 1, 1, 1, 1], seen: [6] },
  ],
  // R11 悬赏决策. Five lists in 9 drafts. slots is the group count (the build sets it from hunterGroups.length),
  // so the from-scratch arm of hunterFill does not run. [ASSUMED] 15 events with only these 5 lists showing in
  // all 9 drafts is about 5e-5; the same call as 下半, which set slots to the number of lists it had seen.
  // The `open` card is the only place an unseen hunter card enters. [ASSUMED] a list seen once, or the same 6
  // cards twice (1 in 7 of omitting one hidden card both times), keeps open 1, as 下半 stored its short lists.
  // Two tier-III cards in one list, and two of series 13, are what the screens showed. 下半's "at most one
  // giant" does not hold here and is not applied to these groups.
  hunterGroups: [
    { cards: ['11_8', '12_7', '14_7', '15_7', '16_1', '16_12', '16_13'].map(EE), hits: [2, 2, 2, 3, 3, 3, 3], seen: [1, 3, 4] },
    { cards: ['10_8', '11_7', '13_7', '13_8', '14_7', '16_7', '16_9'].map(EE), hits: [2, 2, 1, 2, 2, 1, 2], seen: [2, 11] },
    { cards: ['10_8', '11_7', '12_7', '14_7', '16_6', '16_12'].map(EE), hits: [2, 2, 2, 2, 2, 2], seen: [5, 7], open: 1 },
    { cards: ['10_7', '11_8', '13_7', '15_7', '16_2', '16_13'].map(EE), hits: [1, 1, 1, 1, 1, 1], seen: [8], open: 1 },
    { cards: ['11_7', '12_7', '15_7', '16_4', '16_10', '16_11'].map(EE), hits: [1, 1, 1, 1, 1, 1], seen: [10], open: 1 },
  ],
  // [ASSUMED] the open card uses 下半's hunterFill. The build adds every tier-III hunter card as `giants`
  // (聆风猎手 enemyeffect_16_13 is tier III) and every tier I / II hunter card as `cards`.
  hunterRule: { size: 7, onePerSeries: [10, 11, 12, 13, 14, 15], maxSeries16: 2 },
  assumed: {
    initial: [
      'a uniform pick among the 10 events [ASSUMED]',
      'the 3 unseen events built by `rule` (I I I II II III III, at most two of one series) [ASSUMED]',
      'match 1 and match 13 stored as the 6 cards shown [ASSUMED]',
    ],
    boss: [
      'one group per bossInitial event, picked by the matches it came in, not by the leader [ASSUMED]',
      'card weights 1 + hits [ASSUMED]',
      'matches 1 and 9 are one group [ASSUMED]',
      'match 6 stored as the 6 cards shown [ASSUMED]',
      'boss bounties of no seen group are not offered',
    ],
    hunter: [
      'slots = the 5 seen lists, so no list is built from nothing [ASSUMED]',
      'card weights 1 + hits [ASSUMED]',
      'a list seen once, and the list whose same 6 cards came twice, keep open 1 [ASSUMED]',
      'two tier-III cards, and two of one series, stay in the stored lists',
    ],
  },
};

/**
 * R11 机密商店 (matches 9, 12, 14, 15). Six slots, drawn with replacement.
 * [ASSUMED] the slot split. Every shop has at least one tier VI and one tier V, and no tier I / II item other
 * than 盟约之币 (match 15, twice). The other four cards, over the four shops, are VI ×3, V ×3, IV ×4, III ×4
 * and 盟约之币 ×2, so one slot is always VI, one is always V, and four slots share that residual.
 */
export const shopDraft = {
  rounds: [11],
  slots: [
    { 6: 1 },
    { 5: 1 },
    { 6: 3, 5: 3, 4: 4, 3: 4, coin: 2 },
    { 6: 3, 5: 3, 4: 4, 3: 4, coin: 2 },
    { 6: 3, 5: 3, 4: 4, 3: 4, coin: 2 },
    { 6: 3, 5: 3, 4: 4, 3: 4, coin: 2 },
  ],
  coin: '盟约之币',
  seen: {
    驮兽储蓄罐: 4, 变形同构体: 3, 人事部文档: 3, 不退者力场: 2, 瓶装烈性反应: 2, M3茧甲: 2,
    博士投影: 1, 寻呼模块: 1, 拟态物质: 1, 汲取者之心: 1, 动能单手弩: 1, 人事部记录: 1, 盟约之币: 2,
  },
  matches: [9, 12, 14, 15],
  assumed: [
    'one slot always VI, one always V, four slots the residual tier counts [ASSUMED]',
    'item weights 1 + the cards an item showed on [ASSUMED]',
    'solo shows 3 of the 6',
    'other rounds keep tiers I–VI with replacement',
  ],
};

/**
 * R11 战术决策 (matches 6 and 13). Both drafts are ally cards only, and match 13 offers 列装 twice.
 * [ASSUMED] kinds ally: two drafts showed no 排斥 / 责罚 / 裁决 and no terrain card. Independent draws, the
 * same call as 下半 (no slot structure). A 驰援 / 盟誓 card is still dropped at runtime when its bond is dead.
 */
export const tacticDraft = {
  rounds: [11],
  kinds: ['ally'],
  seen: {
    列装: 2, 卡西米尔驰援: 1, 阿戈尔驰援: 1, 升华: 1, 财富: 1, 整备: 1, 歌蕾蒂娅的盟誓: 1,
    艾雅法拉的盟誓: 1, 乌萨斯驰援: 1, 赫拉格的盟誓: 1, 伊比利亚驰援: 1,
  },
  matches: [6, 13],
  assumed: [
    'card weights 1 + the cards a card showed on [ASSUMED]',
    'ally cards only [ASSUMED]',
    'independent draws (no slot structure)',
    'solo shows 3',
    'other rounds keep every card, uniform, with replacement',
  ],
};
