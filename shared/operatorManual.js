// shared/operatorManual.js — the operator manual: a knowledge base of operator passives for every AI strategy
// (the preset personas of shared/botPersonas.js, 随机应变 and the default weighted bot); also readable as a human
// reference. Data verified against data/garrisons.json / data/chess.json; the effect implementations live in
// server/sim/content/garrisons/meta.js (SERVER_GAIN→onGain, SERVER_PREP_START→onRoundStart, SERVER_PREP_FIN→
// onPrepEnd, SERVER_CHESS_SOLD→onSold, SERVER_REFRESH_SHOP→onRefresh).
//
// Terms:
//   获得时 (on gain)        SERVER_GAIN       fires once on buy/gift (×2 with the 投资人 bond active / ×3 at 100+ layers)
//   进入休整期 (prep start) SERVER_PREP_START every round start (must be fielded; a few note "works from the bench")
//   休整期结束 (prep end)   SERVER_PREP_FIN   every round end (must be fielded; a few note "works from the bench")
//   售出时 (on sell)        SERVER_CHESS_SOLD fires on sale
//   刷新时 (on refresh)     SERVER_REFRESH_SHOP fires on a shop reroll
//   身前/身后 (front/behind) the adjacent tiles along the operator's facing (default right = col+1 front, col-1
//                            behind; the 4×9 field spans rows 9-12 / cols 2-10)
//   自身盟约 (own bonds)    SERVER_ADD_BOND_CHESS_ALL stacks every bond the operator belongs to (fires without
//                            activation, but the layers only land on already-active bonds)
//
// The manual's three laws (the whole file hangs off them):
//   1. An engine that stacks every round (PREP_START / PREP_FIN / in battle) grows in value with the round count —
//      the earlier it is drafted the more it pays;
//   2. on-gain effects are one-shot, unless 铃兰 re-triggers them every round or the 投资人 bond doubles them;
//   3. positional traits (front / behind / same row) are free amplifiers — standing right is worth an extra operator.
// -------------------------------------------------------------------------------------------------

/** bondId 速查（data/bonds.json）：yanShip炎 sargonShip萨尔贡 victoriaShip维多利亚 kjeragShip谢拉格
 * lateranoShip拉特兰 egirShip阿戈尔 siracusaShip叙拉古 kazimierzShip卡西米尔（以上核心）
 * preciShip精准 swiftShip迅捷 skillfulShip灵巧 arcaneShip奥术 steadShip坚守 deputShip助力
 * visiShip远见 miraShip奇迹 investShip投资人 raidShip突袭 indomShip不屈 maniShip调和 */

// =================================================================================================
// PART A — layer engines (who stacks which bond, roughly how much per round)
// =================================================================================================
// trigger: gain (one-shot) | prepStart (per round, round start) | prepFin (per round, round end) | refresh
//          | battle (in battle) | sold (on sale) | price (price rewrite, no layers)
// effects[].bonds: the target bonds; 'self' = the operator's own bonds; 'mostActive' = the active bond with the most layers
// effects[].n: layers per trigger (for battle engines this is per event; the real per-round rate depends on the battle tempo, estimated at 0.3-0.6 hits)
// effects[].per: the multiplier of n (shoplv = the 调度中心 level, gained = operators gained this round,
//                spent3 = per 3 funds spent, refresh = per reroll, rowN = same-row operators, handN = bench
//                operators, distinctTier = distinct fielded tiers of the same faction)
// effects[].cap: a per-round / per-battle cap
// effects[].bench: true = works from the bench (hand) too, no need to field
// effects[].front/behind: positional requirements (the operator one tile front/behind also benefits)

export const LAYER_ENGINES = {
  // ---- on gain (one-shot; 铃兰 re-triggers; 投资人 ×2/×3) ----
  'chess_char_4_17_a': { name: 'Hoshiguma', tier: 4, trigger: 'gain', effects: [{ bonds: 'self', n: 8 }], note: 'On gain: +8 to her own bonds. The biggest one-shot layer stack in the game; the first pick to stand ahead of Suzuran.' },
  'chess_char_6_19_a': { name: 'Degenbrecher', tier: 6, trigger: 'gain', effects: [{ bonds: 'self', n: 8 }, { bonds: 'self', n: 8, cap: 24, when: 'deploy' }], note: 'On gain: +8 to his own bonds, +8 more on each deploy (at most 24 per battle).' },
  'chess_char_4_13_a': { name: 'Gnosis', tier: 4, trigger: 'gain', effects: [{ bonds: 'self', n: 5 }], note: 'On gain: +5 to his own bonds (Kjerag + Agile). A core piece of the Touch Kjerag pivot.' },
  'chess_char_3_18_a': { name: 'Vulpisfoglia', tier: 3, trigger: 'gain', effects: [{ bonds: 'self', n: 6 }], note: 'On gain: +6 to her own bonds (Siracusa + Swift) — for the Swift line, not a Siracusa entry.' },
  'chess_char_2_18_a': { name: 'Ashlock', tier: 2, trigger: 'gain', effects: [{ bonds: 'mostActive', n: 3 }], note: 'On gain: +3 to the most active bond. A generic filler; also one of the Flametail free handouts.' },
  'chess_char_2_03_a': { name: 'Cliffheart', tier: 2, trigger: 'gain', effects: [{ bonds: 'self', n: 3 }], note: 'On gain: +3 to her own bonds (Kjerag + Resilient).' },
  'chess_char_2_15_a': { name: 'Akkord', tier: 2, trigger: 'gain', effects: [{ bonds: 'self', n: 4 }], note: 'On gain: +4 to her own bonds (Arcane + Aid) — a good filler for the Aid line.' },
  'chess_char_1_02_a': { name: 'Matterhorn', tier: 1, trigger: 'gain', effects: [{ bonds: 'self', n: 2 }], note: 'On gain: +2 to his own bonds (Kjerag + Durable).' },
  'chess_char_1_11_a': { name: 'Earthspirit', tier: 1, trigger: 'gain', effects: [{ bonds: 'self', n: 2 }], note: 'On gain: +2 to her own bonds (Marvel + Foresight).' },
  'chess_char_1_12_a': { name: 'Estelle', tier: 1, trigger: 'gain', effects: [{ bonds: 'self', n: 2 }], note: 'On gain: +2 to her own bonds (Sargon).' },
  'chess_char_1_16_a': { name: 'Tin Man', tier: 1, trigger: 'gain', effects: [{ bonds: 'self', n: 2 }], note: 'On gain: +2 to his own bonds (Investor + Swift); in battle Investor/Swift grant +1% ATK and HP per 3 layers.' },
  'chess_char_1_17_a': { name: 'Indigo', tier: 1, trigger: 'gain', effects: [{ bonds: 'self', n: 2 }], note: 'On gain: +2 to her own bonds (Arcane + Precision).' },
  'chess_char_1_19_a': { name: 'Wild Mane', tier: 1, trigger: 'gain', effects: [{ bonds: 'self', n: 2 }], note: 'On gain: +2 to her own bonds (Kazimierz + Swift). She and Ashlock are the Flametail per-round handouts.' },
  'chess_char_4_15_a': { name: 'Record Keeper', tier: 4, trigger: 'gain', effects: [{ bonds: ['yanShip', 'miraShip'], n: [6, 3] }], note: 'On gain: +6 Yan, +3 Marvel. The Yan line engine.' },
  'chess_char_5_03_a': { name: 'Blaze the Igniting Spark', tier: 5, trigger: 'gain', effects: [{ bonds: ['yanShip', 'victoriaShip'], n: [5, 5] }], note: 'On gain: +5 each Yan and Victoria.' },
  'chess_char_1_03_a': { name: 'Leizi', tier: 1, trigger: 'gain', effects: [{ bonds: ['yanShip'], n: 1, per: 'shoplv' }], note: 'On gain: +Yan equal to the Dispatch Center level — the earlier the level-ups the bigger the payoff; pairs with an early-leveling curve.' },
  'chess_char_4_19_a': { name: 'Flametail', tier: 4, trigger: 'gain', effects: [{ bonds: [], n: 0, grant: 'a Wild Mane or Ashlock (rarely Fartooth)' }], note: 'On gain: a free Wild Mane or Ashlock (rarely Fartooth). The top Suzuran partner: a free operator every round.' },

  // ---- prep start (per round; must be fielded) ----
  'chess_char_3_21_a': { name: 'Archetto', tier: 3, trigger: 'prepStart', effects: [{ bonds: 'selfAndFront', n: 3 }], note: 'Prep start: herself and the operator one tile ahead each gain +3 to their active bonds per round. Put the layering squad ahead of her; Ptilopsis copies her.' },
  'chess_char_4_16_a': { name: 'Texas the Omertosa', tier: 4, trigger: 'prepStart', effects: [{ bonds: [], n: 0, grant: '1 free refresh' }], note: 'One free refresh per round — a perpetual pump under the reroll-heavy constraint. Ptilopsis can copy her.' },
  'chess_char_4_11_a': { name: 'Catherine', tier: 4, trigger: 'prepStart', effects: [{ bonds: [], n: 0, grant: 'a random item (odd rounds)', cond: 'oddRound' }], note: 'Grants a random item on odd-round prep starts. Ptilopsis can copy her (the copy also fires on odd rounds only).' },
  'chess_char_6_03_a': { name: 'Yu', tier: 6, trigger: 'prepStart', effects: [{ bonds: [], n: 0, grant: 'a random operator of the most-populated bond', cond: 'row3' }], note: 'With 3 operators in the same row, a free operator of the most-populated bond every round. The row is a hard requirement.' },
  'chess_char_4_12_a': { name: 'Gladiia', tier: 4, trigger: 'prepStart', effects: [{ bonds: [], n: 0, grant: 'Skadi / Specter / Underflow', cond: 'row3' }], note: 'With 3 in the row, a free Ægir operator every round. The Ægir line perpetual pump.' },
  'chess_char_2_02_a': { name: 'Silence', tier: 2, trigger: 'prepStart', effects: [{ bonds: 'self', n: 2, activeOnly: true }], note: 'Prep start: +2 to her own active bonds per round.' },
  'chess_char_2_13_a': { name: 'Tippi', tier: 2, trigger: 'prepStart', effects: [{ bonds: 'self', n: 2, activeOnly: true }], note: 'Prep start: +2 to her own active bonds per round (Swift + Agile).' },
  'chess_char_5_10_a': { name: 'Suzuran', tier: 5, trigger: 'prepStart', effects: [{ bonds: [], n: 0, trigger: 'front gain' }], note: 'Prep start: re-triggers the on-gain effect of the operator one tile ahead — turns a one-shot engine into a per-round one. See COMBOS.' },
  'chess_char_5_21_a': { name: 'Santalla', tier: 5, trigger: 'prepStart+prepFin', effects: [{ bonds: ['visiShip'], n: 4 }], note: 'Once at prep start and once at prep end: +4 Foresight (+8 per round in total). The strongest Foresight-line engine.' },

  // ---- prep end (per round; must be fielded except where noted bench) ----
  'chess_char_3_02_a': { name: 'Ayerscarpe', tier: 3, trigger: 'prepFin', effects: [{ bonds: 'selfAndBehind', n: 3 }], note: 'Prep end: himself and the operator one tile behind each gain +3 to their active bonds per round. Put the layering squad behind him; Saria copies him.' },
  'chess_char_3_07_a': { name: 'Enforcer', tier: 3, trigger: 'prepFin', effects: [{ bonds: 'selfAndBehind', n: 3 }], note: 'Like Ayerscarpe: self + the tile behind, +3 each per round (Laterano). Ch\'en can field her instead of Ayerscarpe.' },
  'chess_char_5_15_a': { name: 'Thorns the Lodestar', tier: 5, trigger: 'prepFin', effects: [{ bonds: 'selfAndFront', n: 4 }], note: 'Prep end: self + the tile ahead, +4 each per round. Stronger than Ayerscarpe, note the opposite direction.' },
  'chess_char_2_17_a': { name: 'Vetochki', tier: 2, trigger: 'prepFin', effects: [{ bonds: ['steadShip'], n: 4 }], note: '+4 Durable per round — the absolute core of the Durable line; the earlier drafted the better. Saria can copy her.' },
  'chess_char_3_16_a': { name: 'Cuora', tier: 3, trigger: 'prepFin', effects: [{ bonds: ['steadShip'], n: 1, per: 'rowN' }], note: 'Durable = same-row operator count per round. A full row (4) gives +4 — a natural fit for row-stacking layouts.' },
  'chess_char_1_13_a': { name: 'Podenco', tier: 1, trigger: 'prepFin', effects: [{ bonds: 'mostActive', n: 1, bench: true }], note: '+1 to the most active bond per round, works from the bench too — the cheapest trinket; buy it and never field it.' },
  'chess_char_2_14_a': { name: 'Perfumer', tier: 2, trigger: 'prepFin', effects: [{ bonds: 'mostActive', n: 2, bench: true }], note: '+2 to the most active bond per round, works from the bench too. An extremely cost-efficient bench engine.' },
  'chess_char_4_04_a': { name: 'Ines', tier: 4, trigger: 'prepFin', effects: [{ bonds: 'self', n: 5, activeOnly: true }], note: '+5 to her own active bonds per round.' },
  'chess_char_4_14_a': { name: 'Leonhardt', tier: 4, trigger: 'prepFin', effects: [{ bonds: 'self', n: 5, activeOnly: true }], note: '+5 to his own active bonds per round (Swift + Precision).' },
  'chess_char_5_08_a': { name: 'Horn', tier: 5, trigger: 'prepFin', effects: [{ bonds: 'mostActive', n: 2, per: 'distinctTier' }], note: 'Most active bond × distinct fielded tiers ×2 per round — doubles in power with a mixed-tier lineup.' },
  'chess_char_6_14_a': { name: 'Lumen', tier: 6, trigger: 'prepFin', effects: [{ bonds: 'handBonds', n: 2 }], note: 'Every benched operator adds +2 to its active bonds per round. The bigger the hand the stronger.' },
  'chess_char_5_22_a': { name: 'Nymph', tier: 5, trigger: 'prepFin', effects: [{ bonds: ['swiftShip'], n: 2, per: 'handN' }], note: 'Swift = bench operator count ×2 per round. An unexpected fit for hoarder play (economy vehicles kept benched).' },
  'chess_char_3_08_a': { name: 'Mint', tier: 3, trigger: 'prepFin', effects: [{ bonds: ['victoriaShip'], n: 2, per: 'distinctTier' }], note: 'Victoria = distinct fielded Victoria tiers ×2 per round.' },
  'chess_char_6_07_a': { name: 'Vina Victoria', tier: 6, trigger: 'prepFin', effects: [{ bonds: ['victoriaShip', 'miraShip'], n: [3, 2], per: 'distinctTier' }], note: 'Victoria + Marvel, ×3/×2 by distinct fielded tiers. The Victoria line endgame engine.' },
  'chess_char_2_04_a': { name: 'Grain Buds', tier: 2, trigger: 'prepFin', effects: [{ bonds: ['yanShip'], n: 1, per: 'gained' }], note: 'Yan = operators gained this round, per round. Pays most in busy buy/sell rounds.' },
  'chess_char_5_12_a': { name: 'Dusk', tier: 5, trigger: 'prepFin', effects: [{ bonds: ['yanShip', 'arcaneShip'], n: 2, per: 'gained' }], note: 'Yan + Arcane = operators gained this round ×2 per round.' },
  'chess_char_5_17_a': { name: 'Mountain', tier: 5, trigger: 'prepFin', effects: [{ bonds: ['investShip'], n: 1, per: 'gained' }], note: 'Investor = operators gained this round, per round. The Investor line engine.' },
  'chess_char_6_16_a': { name: 'Astgenne the Lightchaser', tier: 6, trigger: 'prepFin', effects: [{ bonds: ['skillfulShip', 'arcaneShip'], n: 2, per: 'spent3' }], note: 'Agile + Arcane = +2 per 3 funds spent this round. The more spent the stronger — the top Agile/Arcane engine (usable by Ch\'en and Russell).' },
  'chess_char_4_10_a': { name: 'Aroma', tier: 4, trigger: 'prepFin', effects: [{ bonds: ['siracusaShip', 'arcaneShip'], n: 2, per: 'refresh', cap: 6 }], note: 'Siracusa + Arcane = rerolls ×2 (at most 6 per round). Fits the reroll-heavy constraint, but enter the Siracusa line with care.' },
  'chess_char_5_20_a': { name: 'Angelina', tier: 5, trigger: 'prepFin', effects: [{ bonds: ['siracusaShip'], n: 4, per: 'refresh', cap: 12 }], note: 'Siracusa = rerolls ×4 (at most 12 per round). The reroll-build Siracusa-only engine.' },
  'chess_char_1_06_a': { name: 'Vendela', tier: 1, trigger: 'prepFin', effects: [{ bonds: ['victoriaShip'], n: 1 }] , note: '+1 Victoria per round.' },
  'chess_char_1_20_a': { name: 'Liskarm', tier: 1, trigger: 'prepFin', effects: [{ bonds: ['indomShip'], n: 1 }], note: '+1 Resilient per round.' },
  'chess_char_3_04_a': { name: 'Swire the Elegant Wit', tier: 3, trigger: 'prepFin', effects: [{ bonds: [], n: 1, grant: '+1 fund next round', benchIf: ['yanShip', 'investShip'] }], note: '+1 fund next round; works from the bench while Yan/Investor is active. An economy trinket.' },
  'chess_char_4_08_a': { name: 'Rose Salt', tier: 4, trigger: 'sold', effects: [{ bonds: [], n: 0, trigger: 'topmost prepFin' }], note: 'On sale: re-fires the prep-end trait of the topmost-rightmost trait operator on the field — replays the Vetochki/Perfumer effect once more.' },

  // ---- on refresh ----
  'chess_char_2_16_a': { name: 'Lappland', tier: 2, trigger: 'refresh', effects: [{ bonds: ['siracusaShip'], n: 4, cap: 1, bench: true }], note: 'First manual reroll of the round: +4 Siracusa, works from the bench too. Siracusa-line only (the default AI uses it).' },

  // ---- in battle (must be fielded; n is per event, hit rate estimated 0.3-0.6) ----
  'chess_char_6_01_a': { name: 'Lemuen', tier: 6, trigger: 'battle', effects: [{ bonds: ['lateranoShip', 'preciShip'], n: 2, per: 'bullets10', cond: 'row3' }], note: 'Per 10 bullets spent: with 3 in the row, +2 each Laterano and Precision. The Ch\'en endgame engine (with Exusiai the New Covenant / Executor the Ex Foedere feeding the bullets).' },
  'chess_char_5_01_a': { name: 'Executor the Ex Foedere', tier: 5, trigger: 'battle', effects: [{ bonds: ['lateranoShip', 'visiShip'], n: [7, 3], per: 'bullets7', cap: 7 }], note: 'Per 7 bullets: +7 Laterano, +3 Foresight (each at most 7 times). The ammo-build Laterano perpetual engine.' },
  'chess_char_4_02_a': { name: 'Mostima', tier: 4, trigger: 'battle', effects: [{ bonds: ['lateranoShip'], n: 1, per: 'bullets6around' }], note: 'Per 6 bullets spent by the operators on the 4 surrounding tiles: +1 Laterano. Stand her among the ammo operators.' },
  'chess_char_2_01_a': { name: 'Executor', tier: 2, trigger: 'battle', effects: [{ bonds: ['preciShip', 'lateranoShip'], n: 3, cap: 1 }], note: 'First kill: +3 each Precision and Laterano. A cheap opening filler.' },
  'chess_char_3_05_a': { name: 'Skadi', tier: 3, trigger: 'battle', effects: [{ bonds: ['egirShip', 'steadShip', 'raidShip'], n: 1, per: 'kills2' }], note: 'Per 2 kills: +1 each Ægir, Durable and Raid. The Durable-line battle engine.' },
  'chess_char_5_13_a': { name: 'Specter the Unchained', tier: 5, trigger: 'battle', effects: [{ bonds: ['egirShip', 'indomShip'], n: 5, per: 'selfDown' }], note: 'On being downed / stand-in swap: +5 each Ægir and Resilient.' },
  'chess_char_2_07_a': { name: 'Specter', tier: 2, trigger: 'battle', effects: [{ bonds: ['egirShip'], n: 3, per: 'selfDown' }], note: '+3 Ægir when downed.' },
  'chess_char_3_09_a': { name: 'Lucilla', tier: 3, trigger: 'battle', effects: [{ bonds: ['egirShip', 'arcaneShip'], n: 3, cap: 1 }], note: 'First kill (enemy or ally): +3 each Ægir and Arcane.' },
  'chess_char_4_23_a': { name: 'Gavial the Invincible', tier: 4, trigger: 'battle', effects: [{ bonds: ['sargonShip'], n: 9, per: 'skill' }], note: 'On skill cast: +9 Sargon. The strongest Sargon-line battle engine.' },
  'chess_char_3_06_a': { name: 'Philae', tier: 3, trigger: 'battle', effects: [{ bonds: ['sargonShip'], n: 6, per: 'skill' }], note: 'On skill cast: +6 Sargon.' },
  'chess_char_2_06_a': { name: 'Papyrus', tier: 2, trigger: 'battle', effects: [{ bonds: ['sargonShip'], n: 5, cap: 1 }], note: 'First skill cast: +5 Sargon.' },
  'chess_char_5_02_a': { name: 'Titi', tier: 5, trigger: 'battle', effects: [{ bonds: ['sargonShip', 'preciShip'], n: 1, per: 'sleepStun', cap: 24 }], note: 'Per enemy/operator in range falling asleep or stunned: +1 each Sargon and Precision (at most 24).' },
  'chess_char_4_07_a': { name: 'Bagpipe', tier: 4, trigger: 'battle', effects: [{ bonds: ['victoriaShip', 'visiShip', 'indomShip'], n: 2, per: 'kills3' }], note: 'First 3 kills: +2 each Victoria, Foresight and Resilient.' },
  'chess_char_3_14_a': { name: 'Pramanix', tier: 3, trigger: 'battle', effects: [{ bonds: ['kjeragShip'], n: 1, per: 'freeze50' }], note: '50% chance per freeze of an enemy in range: +1 Kjerag. Pairs with control builds.' },
  'chess_char_4_22_a': { name: 'SilverAsh', tier: 4, trigger: 'battle', effects: [{ bonds: ['kjeragShip'], n: 1, per: 'freeze50' }], note: 'Like Pramanix: 50% per freeze, +1 Kjerag.' },
  'chess_char_5_14_a': { name: 'SilverAsh the Reignfrost', tier: 5, trigger: 'battle', effects: [{ bonds: [], n: 0, grant: 'front freeze trait' }], note: 'The Kjerag operator one tile ahead gains the trait \'60% per freeze: +1 Kjerag\' — turns any Kjerag operator into a SilverAsh.' },
  'chess_char_3_12_a': { name: 'Blemishine', tier: 3, trigger: 'battle', effects: [{ bonds: 'self', n: 4, per: 'deploy', cap: 12 }], note: 'On deploy: +4 to her own active bonds (at most 12 per battle).' },
  'chess_char_5_07_a': { name: 'Surtr', tier: 5, trigger: 'battle', effects: [{ bonds: ['raidShip'], n: 8, per: 'deploy', cap: 50 }], note: 'On deploy: +8 Raid (at most 50 per battle). The Raid-line free layers.' },
  'chess_char_2_12_a': { name: 'Gravel', tier: 2, trigger: 'battle', effects: [{ bonds: ['kazimierzShip'], n: 1, per: 'deploy' }, { bonds: ['indomShip'], n: 2, per: 'selfDown' }], note: '+1 Kazimierz on deploy; +2 Resilient when downed.' },
  'chess_char_4_20_a': { name: 'Fartooth', tier: 4, trigger: 'battle', effects: [{ bonds: ['kazimierzShip', 'preciShip'], n: 4, per: 'rowRightmostDeploy', cap: 24 }], note: 'The rightmost operator of her row gains \'+4 Kazimierz and Precision on deploy\'. Keep the deploy tiles busy.' },
  'chess_char_6_18_a': { name: 'Lappland the Decadenza', tier: 6, trigger: 'battle', effects: [{ bonds: ['siracusaShip'], n: 2, per: 'kill' }], note: 'Per kill: +2 Siracusa (team-wide once elite).' },
  'chess_char_3_19_a': { name: 'Vigil', tier: 3, trigger: 'battle', effects: [{ bonds: ['siracusaShip', 'miraShip'], n: [2, 1], per: 'kills3' }], note: 'First 3 kills: +2 Siracusa, +1 Marvel.' },
  'chess_char_2_09_a': { name: 'Humus', tier: 2, trigger: 'battle', effects: [{ bonds: ['raidShip'], n: 1, per: 'kills2' }], note: 'Per 2 kills: +1 Raid.' },
  'chess_char_6_09_a': { name: 'Virtuosa', tier: 6, trigger: 'battle', effects: [{ bonds: 'mostActive', n: 1, per: 'rowN', cap: 10 }], note: 'On skill cast: most active bond = same-row count ×1 (at most 10 per battle). For row-stacking builds.' },
};

// =================================================================================================
// PART B — economy engines at a glance (buy/sell funds and rerolls across rounds).
// The delicate funds salvage (bridge-leveling, end-of-prep remainder conversion) is implemented in bot.js; this is the knowledge summary.
// =================================================================================================
export const ECON_NOTES = {
  'chess_char_1_08_a': { name: 'Texas', note: 'Costs 2, sells for 1, +1 free refresh on sale (kept across rounds). A funds-salvage vehicle.' },
  'chess_char_1_07_a': { name: 'Provence', note: 'Costs 2, sells for 1, +1 free refresh on gain. A vehicle; behind Suzuran = a free refresh every round.' },
  'chess_char_3_13_a': { name: 'Minimalist', note: 'Costs 1 (a garrison price rewrite), sells for 1 — the cleanest single-fund porter. Note: buying and selling at once gains nothing; hold it to the next round before selling.' },
  'chess_char_1_14_a': { name: 'Greyy', note: '+1 fund next round after the sale. Can be fielded for tempo first, then sold.' },
  'chess_char_4_18_a': { name: 'Mudrock', note: '+2 funds next round after the sale. A vehicle for 2 spare funds.' },
  'chess_char_3_10_a': { name: 'Pinecone', note: 'On sale: a free special recruit of a tier-I operator (tier V once merged into an elite) — a sell-card engine.' },
  'chess_char_3_15_a': { name: 'Shamare', note: 'On sale: +2 free refreshes (+4 as elite).' },
  'chess_char_3_01_a': { name: 'Exusiai', note: 'On gain: +1 fund next round (+2 as elite).' },
  'chess_char_6_13_a': { name: 'Exusiai the New Covenant', note: 'On gain: +2 funds next round (+4 as elite); also a Laterano endgame piece.' },
  'chess_char_3_03_a': { name: 'Swire', note: 'On gain: +1 Alliance Coin (+2 as elite).' },
  item_coin: { name: 'Alliance Coin', note: 'Using it the moment it is bought gains nothing across rounds; hold it to the next round.' },
  item_doll: { name: 'Money-Grubbing Doll', note: 'Destroyed on equip, +2 funds next round — the best home for 1 spare fund.' },
};

// =================================================================================================
// PART C — combos.
// rel semantics (default facing right):
//   'followerBehindAnchor' — follower 必须紧贴 anchor 身后（anchor 在 follower 身前一格，同行，follower.col = anchor.col - 1）
//   'sameRow3'             — 三人必须同一行
// value: the purchase-score bonus (what seeing the other half in the shop is worth while the partner is held; a rough anchor)
// bonds: the bonds the combo mainly serves (for strategy matching; empty = generic)
// =================================================================================================
export const COMBOS = [
  // —— the 铃兰 + 焰尾 pair ——
  { id: 'suzuran_flametail', name: 'Suzuran + Flametail', follower: 'chess_char_5_10_a', anchor: 'chess_char_4_19_a', rel: 'followerBehindAnchor', value: 16, bonds: [],
    note: 'Suzuran behind Flametail: re-triggers her on-gain effect every round — a free Wild Mane/Ashlock (rarely Fartooth) per round, snowballing free operators.' },
  // —— 铃兰 × high-value on-gain engines (ordered by per-round re-trigger value) ——
  { id: 'suzuran_hoshiguma', name: 'Suzuran + Hoshiguma', follower: 'chess_char_5_10_a', anchor: 'chess_char_4_17_a', rel: 'followerBehindAnchor', value: 15, bonds: ['yanShip'], note: '+8 to her own bonds per round (Yan).' },
  { id: 'suzuran_jian', name: 'Suzuran + Degenbrecher', follower: 'chess_char_5_10_a', anchor: 'chess_char_6_19_a', rel: 'followerBehindAnchor', value: 15, bonds: ['kjeragShip', 'kazimierzShip', 'swiftShip'], note: '+8 to his own bonds per round.' },
  { id: 'suzuran_gnosis', name: 'Suzuran + Gnosis', follower: 'chess_char_5_10_a', anchor: 'chess_char_4_13_a', rel: 'followerBehindAnchor', value: 12, bonds: ['kjeragShip', 'skillfulShip'], note: '+5 to his own bonds per round — the Touch Kjerag pivot piece.' },
  { id: 'suzuran_ninwyn', name: 'Suzuran + Vulpisfoglia', follower: 'chess_char_5_10_a', anchor: 'chess_char_3_18_a', rel: 'followerBehindAnchor', value: 11, bonds: ['swiftShip'], note: '+6 to her own bonds per round (Siracusa + Swift; use her on the Swift line).' },
  { id: 'suzuran_ashlock', name: 'Suzuran + Ashlock', follower: 'chess_char_5_10_a', anchor: 'chess_char_2_18_a', rel: 'followerBehindAnchor', value: 10, bonds: [], note: '+3 to the most active bond per round — the jack of all trades.' },
  { id: 'suzuran_cantabile', name: 'Suzuran + Akkord', follower: 'chess_char_5_10_a', anchor: 'chess_char_2_15_a', rel: 'followerBehindAnchor', value: 10, bonds: ['arcaneShip', 'deputShip'], note: '+4 to her own bonds per round (Arcane + Aid).' },
  { id: 'suzuran_provence', name: 'Suzuran + Provence', follower: 'chess_char_5_10_a', anchor: 'chess_char_1_07_a', rel: 'followerBehindAnchor', value: 9, bonds: [], note: '+1 free refresh per round — the reroll-build perpetual pump.' },
  { id: 'suzuran_swire', name: 'Suzuran + Swire', follower: 'chess_char_5_10_a', anchor: 'chess_char_3_03_a', rel: 'followerBehindAnchor', value: 8, bonds: [], note: '+1 Alliance Coin per round.' },
  { id: 'suzuran_lumu', name: 'Suzuran + Exusiai the New Covenant', follower: 'chess_char_5_10_a', anchor: 'chess_char_6_13_a', rel: 'followerBehindAnchor', value: 8, bonds: ['lateranoShip'], note: '+2 funds per round.' },
  { id: 'suzuran_zhuHuang', name: 'Suzuran + Blaze the Igniting Spark', follower: 'chess_char_5_10_a', anchor: 'chess_char_5_03_a', rel: 'followerBehindAnchor', value: 12, bonds: ['yanShip', 'victoriaShip'], note: '+5 each Yan and Victoria per round.' },
  { id: 'suzuran_recorder', name: 'Suzuran + Record Keeper', follower: 'chess_char_5_10_a', anchor: 'chess_char_4_15_a', rel: 'followerBehindAnchor', value: 12, bonds: ['yanShip', 'miraShip'], note: '+6 Yan and +3 Marvel per round.' },
  // —— the 空弦 / 断崖 / 白面鸮 pairings ——
  { id: 'bmk_kongsan', name: 'Ptilopsis + Archetto', follower: 'chess_char_4_21_a', anchor: 'chess_char_3_21_a', rel: 'followerBehindAnchor', value: 16, bonds: ['lateranoShip', 'skillfulShip'],
    note: 'Ptilopsis behind Archetto: copies her prep-start trait — each covers self + the tile ahead at +3 per round, up to 4 operators in total.' },
  { id: 'sar_Duanyai', name: 'Saria + Ayerscarpe', follower: 'chess_char_5_11_a', anchor: 'chess_char_3_02_a', rel: 'followerBehindAnchor', value: 15, bonds: ['skillfulShip', 'steadShip'],
    note: 'Saria behind Ayerscarpe: copies his prep-end trait — each covers self + the tile behind at +3 per round.' },
  { id: 'sar_zheya', name: 'Saria + Vetochki', follower: 'chess_char_5_11_a', anchor: 'chess_char_2_17_a', rel: 'followerBehindAnchor', value: 13, bonds: ['steadShip'],
    note: 'Double +4 Durable per round (+8 in total) — the golden pair of the Durable line (Amiya/Touch/Russell).' },
  { id: 'sar_snakebox', name: 'Saria + Cuora', follower: 'chess_char_5_11_a', anchor: 'chess_char_3_16_a', rel: 'followerBehindAnchor', value: 10, bonds: ['steadShip'],
    note: 'Double \'Durable = same-row count\' per round.' },
  { id: 'sar_ines', name: 'Saria + Ines', follower: 'chess_char_5_11_a', anchor: 'chess_char_4_04_a', rel: 'followerBehindAnchor', value: 10, bonds: [], note: 'Double +5 to her own bonds per round.' },
  { id: 'sar_perfumer', name: 'Saria + Perfumer', follower: 'chess_char_5_11_a', anchor: 'chess_char_2_14_a', rel: 'followerBehindAnchor', value: 8, bonds: [], note: 'Double +2 to the most active bond per round.' },
  { id: 'bmk_silentTexas', name: 'Ptilopsis + Texas the Omertosa', follower: 'chess_char_4_21_a', anchor: 'chess_char_4_16_a', rel: 'followerBehindAnchor', value: 9, bonds: [], note: 'Double free refreshes per round (2 in total).' },
  { id: 'bmk_cathy', name: 'Ptilopsis + Catherine', follower: 'chess_char_4_21_a', anchor: 'chess_char_4_11_a', rel: 'followerBehindAnchor', value: 8, bonds: [], note: 'Double random items on odd rounds.' },
  { id: 'bmk_yu', name: 'Ptilopsis + Yu', follower: 'chess_char_4_21_a', anchor: 'chess_char_6_03_a', rel: 'followerBehindAnchor', value: 10, bonds: [], note: 'Double free operators per round with 3 in the row.' },
  { id: 'bmk_gladiia', name: 'Ptilopsis + Gladiia', follower: 'chess_char_4_21_a', anchor: 'chess_char_4_12_a', rel: 'followerBehindAnchor', value: 10, bonds: ['egirShip'], note: 'Double free Ægir operators per round with 3 in the row.' },
  // —— battle amplifiers (adjacent tile) ——
  { id: 'mora_engine', name: 'Civilight Eterna + battle layer engine', follower: 'chess_char_4_25_a', anchor: 'battleEngine', rel: 'followerBehindAnchor', value: 8, bonds: [],
    note: 'Civilight Eterna behind an in-battle layer engine (Lemuen / Executor the Ex Foedere / Skadi / Gavial the Invincible …): their trait stacks gain +1 extra each time.' },
  { id: 'waflin_dps', name: 'Warfarin + the carry ahead', follower: 'chess_char_4_26_a', anchor: 'dpsFront', rel: 'followerBehindAnchor', value: 7, bonds: [],
    note: 'The operator ahead gains \'+1 to its active bonds on skill cast\' (at most 7 per battle). Place her behind a frequently-casting carry.' },
  { id: 'kross_preci', name: 'Kroos the Keen Glint + a Precision carry', follower: 'chess_char_4_06_a', anchor: 'dpsFront', rel: 'followerBehindAnchor', value: 7, bonds: ['preciShip'],
    note: 'The operator ahead gains \'+1 Precision on skill cast\' (at most 10 per battle) — the dedicated amplifier of the Precision line (Ch\'en).' },
  { id: 'silverash_kjerag', name: 'SilverAsh the Reignfrost + a Kjerag operator', follower: 'chess_char_5_14_a', anchor: 'kjeragChess', rel: 'followerBehindAnchor', value: 7, bonds: ['kjeragShip'],
    note: 'The Kjerag operator ahead gains \'60% per freeze: +1 Kjerag\' — turns any Kjerag operator into a SilverAsh.' },
  // —— same-row combos ——
  { id: 'row3_laterano', name: 'Laterano same-row trio', follower: 'chess_char_6_01_a', anchor: 'chess_char_6_13_a', rel: 'sameRow3', value: 10, bonds: ['lateranoShip', 'preciShip'],
    note: 'Lemuen + Exusiai the New Covenant (+ Executor the Ex Foedere / Archetto) in one row: the Lemuen per-10-bullets grants +2 each Laterano and Precision. The Ch\'en core formation.' },
  { id: 'row3_egir', name: 'Ægir same-row trio', follower: 'chess_char_4_12_a', anchor: 'chess_char_6_04_a', rel: 'sameRow3', value: 8, bonds: ['egirShip'],
    note: 'Gladiia with 3 in the row hands out a free Ægir operator every round; Skadi the Corrupting Heart heals off Ægir layers.' },
];

// =================================================================================================
// PART D — runtime helpers (consumed by bot.js; gamedata validation in test/match/bot-persona.test.js)
// =================================================================================================

/** The anchor tag resolutions. battleEngine = an in-battle layer engine; dpsFront = the main carry; kjeragChess = a 谢拉格 operator (see KJERAG_CHESS). */
export const ANCHOR_TAGS = {
  battleEngine: ['chess_char_6_01_a', 'chess_char_5_01_a', 'chess_char_3_05_a', 'chess_char_4_23_a', 'chess_char_6_18_a', 'chess_char_3_19_a', 'chess_char_2_09_a'],
};

/** Every combo a chess takes part in. Returns [{ combo, role: 'follower'|'anchor' }]. */
export function combosOf(chessId) {
  const out = [];
  for (const combo of COMBOS) {
    if (combo.follower === chessId) out.push({ combo, role: 'follower' });
    else if (combo.anchor === chessId) out.push({ combo, role: 'anchor' });
  }
  return out;
}

/**
 * Whether a combo is "alive" for a player: the partner is already held (for purchase scoring). ownedBases = the player's held chess baseIds.
 * Tag anchors (battleEngine / dpsFront / kjeragChess): holding any operator of that class counts as the partner.
 * Returns the purchase bonus the chess thereby earns (combos stack, capped at 18); 0 without a partner.
 */
export function comboCompletionBonus(chessId, ownedBases, isDps) {
  let bonus = 0;
  for (const { combo, role } of combosOf(chessId)) {
    const partner = role === 'follower' ? combo.anchor : combo.follower;
    let owned = false;
    if (typeof partner === 'string' && /chess_/.test(partner)) owned = ownedBases.has(partner);
    else if (partner === 'battleEngine') owned = ANCHOR_TAGS.battleEngine.some((id) => ownedBases.has(id));
    else if (partner === 'dpsFront') owned = !!isDps && ownedBases.size >= 4; // 有主C在场才有放大意义
    else if (partner === 'kjeragChess') owned = [...ownedBases].some((b) => KJERAG_CHESS.has(b));
    if (owned) bonus += combo.value; // partner in hand: the full bonus — completing combos is the manual's core execution goal
  }
  return Math.min(bonus, 22);
}

/** The 谢拉格 operator set (the kjeragChess tag anchor's runtime criterion, data/chess.json). */
export const KJERAG_CHESS = new Set([
  'chess_char_1_02_a', 'chess_char_2_03_a', 'chess_char_2_05_a', 'chess_char_3_11_a', 'chess_char_3_14_a', 'chess_char_3_20_a',
  'chess_char_4_03_a', 'chess_char_4_13_a', 'chess_char_4_22_a', 'chess_char_5_14_a', 'chess_char_6_02_a', 'chess_char_6_19_a',
]);

/**
 * A layer engine's estimated layers-per-round (for purchase scoring).
 * @param {string} chessId
 * @param {{ bondWeight?: (bondId: string) => number, bondsOf?: (chessId: string) => string[], activeBonds?: Set<string> }} [opts]
 *   bondWeight: (bondId) => the numeric weight (a persona's bondPref or the default 5; negative = avoided);
 *   bondsOf: (chessId) => the chess's own bond ids (resolving 'self'-type engines; default weight 5 without it);
 *   activeBonds: the set of already-active bonds (most engines only really feed an activated bond).
 */
export function engineLayerValue(chessId, { bondWeight, bondsOf, activeBonds } = {}) {
  const e = LAYER_ENGINES[chessId];
  if (!e) return 0;
  const defaultW = typeof bondWeight === 'function' ? bondWeight : () => 5;
  const w = (b) => {
    if (b === 'self' || b === 'selfAndFront' || b === 'selfAndBehind' || b === 'handBonds') {
      // own-bonds type: the highest weight among the chess's bonds (the layers land on the active one anyway)
      const own = typeof bondsOf === 'function' ? bondsOf(chessId) : null;
      return own && own.length ? Math.max(...own.map(defaultW)) : 5;
    }
    return Math.max(0, defaultW(b));
  };
  const activeFactor = (bonds) => {
    if (!activeBonds || !activeBonds.size) return 0.5; // no bond active yet: board the engine first, the layers follow
    return bonds === 'self' || bonds === 'selfAndFront' || bonds === 'selfAndBehind' ? 0.6 : 1;
  };
  let v = 0;
  for (const eff of e.effects || []) {
    if (!eff.bonds || !eff.bonds.length || typeof eff.bonds === 'string') continue; // freebie type (grants an operator/item/funds) — no layers counted
    const triggerFactor = e.trigger === 'gain' ? 0.35 : e.trigger === 'battle' ? 0.4 : e.trigger === 'refresh' ? 1.5 : 1;
    const perFactor = eff.per ? 2 : 1; // multiplier type (gained/spent3/refresh…) estimated at the median ×2
    const list = Array.isArray(eff.bonds) ? eff.bonds : [eff.bonds];
    list.forEach((b, i) => {
      const n = Array.isArray(eff.n) ? eff.n[i] ?? eff.n[eff.n.length - 1] : eff.n;
      if (!(n > 0)) return;
      v += n * w(b) * triggerFactor * perFactor * activeFactor(list) / 10;
    });
  }
  return Math.min(v, 14);
}
