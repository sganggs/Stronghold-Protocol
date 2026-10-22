// Editable advisory knowledge, NOT generated game data. Every recommendation is [ASSUMED].
// Names below are source labels for the AI catalogue, not interface msgids.
// i18n-ignore: maintainer's Chinese strategy names, retained alongside stable IDs
const source = 'Maintainer first-hand/community guidance, 2026-10-19; docs/AI-STRATEGY.md';
export const COMMUNITY = {
  revision: '2026-10-19',
  mains: [
    ['band_duyaoy', 'yanShip'], ['band_ermengard', 'egirShip'], ['band_pepe', 'sargonShip'],
    ['band_paganini', 'lateranoShip'], ['band_harold', 'victoriaShip'], ['band_chiave', 'siracusaShip'],
    ['band_emperor', 'kazimierzShip'], ['band_narant', 'sargonShip'], ['band_sciurus', 'kjeragShip'],
    ['band_clementia', 'egirShip'], ['band_mlynar', 'kazimierzShip'],
  ].map(([band, main]) => ({ band, main, source })),
  pairs: [
    ['lateranoShip', ['preciShip', 'skillfulShip']],
    ['sargonShip', ['preciShip', 'swiftShip', 'skillfulShip']],
    ['victoriaShip', ['arcaneShip']], ['siracusaShip', ['arcaneShip']], ['yanShip', ['arcaneShip']],
    ['kjeragShip', ['arcaneShip', 'preciShip', 'skillfulShip']],
    ['kazimierzShip', ['raidShip', 'indomShip']], ['egirShip', ['raidShip', 'indomShip']],
  ].map(([main, subs]) => ({ main, subs, source })),
  builds: [
    // Maintainer 2026-10-19 supplied these summaries/URLs; no network retrieval or video transcription.
    // [ASSUMED] Roles, substitutions and stages adapt the recipes to the visible roster; mechanics win below.
    { id: 'kjerag-freeze', name: '谢拉格冰冻叠层', final: '谢讯', status: 'community', archetype: 'freeze', // i18n-ignore: sourced AI build names, not UI msgids
      source, bonds: ['kjeragShip'], subs: ['swiftShip', 'skillfulShip', 'arcaneShip'],
      sources: ['https://forum.gamer.com.tw/C.php?bsn=33651&snA=12770', 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316',
        'https://www.233leyuan.com/post-detail/1993914451791876096', 'https://www.bilibili.com/video/BV1xVdBBWEuu/',
        'https://www.qieyou.com/content/146194'],
      members: [
        { name: '初雪', role: 'collector' }, { name: '银灰', role: 'collector' }, // i18n-ignore: sourced operator names resolved against chess data
        { name: '灵知', role: 'freezer' }, { name: '耶拉', role: 'ice' }, // i18n-ignore: sourced operator names resolved against chess data
        { name: '角峰', role: 'early' }, { name: '空弦', role: 'support' }, { name: '魔王', role: 'support' }, // i18n-ignore: sourced operator names resolved against chess data
        { name: '归溟幽灵鲨', alias: '异鲨', role: 'optional' }, { name: '阿斯卡纶', role: 'optional' }, // i18n-ignore: community aliases and operator names
        { name: '凛御银灰', alias: '异银', role: 'late' }, { name: '妮芙', role: 'late' }, // i18n-ignore: community aliases and operator names
      ],
      requiredRoles: ['collector', 'freezer'], shopTiming: 'Reach L3 for the collector/ice/support, L4 for Gnosis and Civilight Eterna; L5 for SilverAsh Alter/Nymph. No permanent L4 hold.',
      stages: [
        { stage: 'R1-3', roles: ['early', 'ice', 'collector'], goal: 'Survive with cheap blockers; gather three distinct Kjerag, a freeze collector and a cold source.' },
        { stage: 'R4-7', roles: ['collector', 'freezer', 'ice', 'support'], goal: 'Reach L3-4; use charged Gnosis S2 in the collector range. Kjera supplies ice; put the collector in front of Civilight Eterna.' },
        { stage: 'R8-10', roles: ['late', 'support', 'collector', 'freezer'], goal: 'Prefer SilverAsh Alter/Nymph elite opportunities at L5; keep three Kjerag, add Swift/Skillful or conditional Arcane and layer support.' },
        { stage: 'late', roles: ['late', 'collector', 'freezer'], goal: 'Kjerag + Swift for the final leader; repeated sub-limit hits, sustain and reveal. Avoid excessive Arcane amplification at the leader hit limit.' },
      ],
      preconditions: ['Three distinct Kjerag on board and their bond active; one collector plus one freezer is only the engine core.',
        'Freeze transitions must occur inside the collector range; charged S2/cold overlap and equipment are conditional.',
        'Elite priority means merging available copies, not a guaranteed reward or shop roll.'],
      counters: ['Repeated freeze can control melee enemies; near-permanent control is a community expectation, not a guarantee.'],
      avoid: ['Area damage can kill the clustered engine.', 'Many stealth enemies need reveal before cold attacks can target them.',
        'Freeze immunity, poor cold overlap, or leader hits at/above the damage limit invalidate the plan.'],
      substitutes: ['SilverAsh can replace Pramanix as collector; a cheap Kjerag fills the third distinct slot.',
        'Community no-Gnosis route: Ascalon plus two Kjerag ice carriers. Ascalon is absent here: do not propose that exact route.',
        '[ASSUMED] Two owned ice-equipped attackers with overlapping cold are a conditional fallback, not a proven Gnosis replacement.'],
      evidence: { bonds: ['kjeragShip', 'swiftShip'], garrisons: ['garrison_28_a', 'garrison_29_a', 'garrison_126_a', 'garrison_40_a', 'garrison_150_a', 'garrison_59_a', 'garrison_56_a'],
        items: ['chess_item_5_02_e_a', 'chess_item_5_02_e_b'] },
      disagreements: [
        { rule: 'freeze-credit', community: 'Enemies frozen in freezer range add Kjerag layers; one stacker + freezer starts it.',
          current: 'Requires three active Kjerag. Pramanix/SilverAsh collect with 50% chance, +1 per in-range freeze transition; SilverAsh Alter grants the front Kjerag a 60% version capped at 200/battle. The freezer need not be the collector.' },
        { rule: 'support-roles', community: 'Archetto, Specter Alter and Ascalon support the stacking engine.',
          current: 'Archetto has no innate cold: prep-start +3 own/front active bonds; ice is 12%/20% cold for 1.5s. Specter Alter grows Egir/Indomitable, not Kjerag; needs a separately verified grant to collect Kjerag. Ascalon is absent from chess.json.' },
        { rule: 'three-versus-six', community: 'Three Kjerag suffice for near-permanent freeze.',
          current: 'Three unlock damage multipliers only (1.25 normally, 1.35 + 0.01/layer versus cold/frozen, replacing 1.25). Six unlock the 25s wind (20 + 0.1/layer seconds cold); three need an external cold engine.' },
      ],
    },
    { id: 'kazimierz-redeploy', name: '卡西米尔部署叠层 / 突袭卡西米尔', final: '卡突袭迅', status: 'community', archetype: 'redeploy', // i18n-ignore: sourced AI build names, not UI msgids
      source, bonds: ['kazimierzShip'], subs: ['raidShip', 'swiftShip', 'steadShip', 'indomShip'],
      sources: ['https://forum.gamer.com.tw/C.php?bsn=33651&snA=12770', 'https://www.taptap.cn/moment/782049742673676589',
        'https://www.bilibili.com/video/BV1XLwhz8ESa/'],
      members: [
        { name: '远牙', role: 'grant' }, { name: '砾', role: 'redeployer' }, { name: '瑕光', role: 'redeployer' }, // i18n-ignore: sourced operator names resolved against chess data
        { name: '野鬃', role: 'early' }, { name: '灰毫', role: 'defense' }, { name: '焰尾', role: 'economy' }, // i18n-ignore: sourced operator names resolved against chess data
        { name: '铃兰', role: 'economy' }, { name: '耀骑士临光', role: 'late' }, // i18n-ignore: sourced operator names resolved against chess data
      ],
      requiredRoles: ['grant', 'redeployer'], shopTiming: 'Keep cheap Kazimierz; reach L3 for Blemishine, L4 for Fartooth/Flametail. Suzuran operator needs L5; the Suzuran band is a separate draft choice.',
      stages: [
        { stage: 'R1-3', roles: ['early', 'redeployer', 'defense'], goal: 'Survive with cheap Kazimierz and reach three distinct members; preserve Gravel and Blemishine.' },
        { stage: 'R4-7', roles: ['grant', 'redeployer', 'defense', 'economy'], goal: 'Reach L4 Fartooth; put Gravel rightmost in her row to receive the deployment trait. Prioritize Steadfast survival for the gun-knight stage.' },
        { stage: 'R8-10', roles: ['grant', 'redeployer', 'economy'], goal: 'Use Raid redeploys; Swift on Blemishine requires a morph plus Swift equipment and an active bond. Suzuran/Flametail gives conditional copies, not assured cash.' },
        { stage: 'late', roles: ['grant', 'redeployer', 'late'], goal: 'Kazimierz + Raid + Swift for the final leader; reach deployment caps while preserving blockers, healing and repeated sub-limit damage.' },
      ],
      preconditions: ['Three active distinct Kazimierz; Fartooth and a repeatedly deploying receiver in her rightmost-row position.',
        'Raid needs two distinct members, a ground landing target, and its no-enemy-in-range / idle-or-skill-ready trigger.',
        'Swift feeding requires actual bond-grant equipment; do not infer it from a bond-layer increase.'],
      counters: ['Deployment boosts damage; Steadfast is community-recommended survival against the gun-knight stage, not a universal mechanical requirement.'],
      avoid: ['Area/ranged pressure can kill the receiver or damage dealers before the engine pays off.',
        'Three Steadfast shares damage and can delay Gravel deaths/redeploys; balance survival against cycling.',
        'Raid cannot jump without a legal ground target; capped layer traits and leader damage limits prevent unlimited gains.'],
      substitutes: ['Blemishine can receive the Fartooth trait instead of Gravel when Raid triggers are feasible.',
        'Without Fartooth, Gravel/Blemishine retain their own smaller deployment gains; this is a fallback, not the named core.',
        'Wild Mane/Ashlock fill cheap membership; Indomitable is the maintainer 2026-10-19 alternative to defensive Steadfast.'],
      evidence: { bonds: ['kazimierzShip', 'raidShip', 'swiftShip', 'steadShip', 'indomShip'],
        garrisons: ['garrison_143_a', 'garrison_148_a', 'garrison_108_a', 'garrison_106_a', 'garrison_149_a', 'garrison_60_a'],
        bands: ['band_lisa', 'band_mlynar'], items: ['chess_item_3_05_e_a'] },
      disagreements: [
        { rule: 'deployment-caps', community: 'Repeated deployment maximizes stacking.',
          current: 'Three Kazimierz grant +20% ATK per friendly deployment capped at 50% + 1%/layer, not unlimited layers. Gravel gives +1 active Kazimierz; Fartooth grants +4 Kazimierz/Precision capped at 24/battle; Blemishine gives +4 own active bonds capped at 12/battle (normal forms).' },
        { rule: 'swift-membership', community: 'Feed Blemishine Swift to stack Kazimierz/Raid/Swift by deployment.',
          current: 'Her native bonds are Kazimierz/Raid. Swift needs morph + Swift-tagged equipment (bondsMeta.js); Swift rations alone grant SP, not membership. Only active owned bonds receive her deployment layers.' },
        { rule: 'steadfast-tradeoff', community: 'Steadfast is essential for gun-knight survival.',
          current: 'Situational advice: two grant HP; three share 40% of non-Steadfast damage and can slow Gravel cycling. bonds.json spec.howToPlay records older contrary advice to avoid Steadfast; that annotation is not a ban.' },
        { rule: 'suzuran-income', community: 'Suzuran plus L4 Kazimierz cards gives 1-2 extra funds per round.',
          current: 'No fixed cash payout: band_lisa replays one on-field SERVER_GAIN at round start; T5 Suzuran replays the front one at prep start. L4 Flametail grants a stock-dependent Wild Mane/Ashlock/Fartooth, while Fartooth has no SERVER_GAIN. Selling surplus copies yields the current sellPrice and loses those copies. band_mlynar is the separate +1 next-round fund per Kazimierz purchase, capped at 3.' },
      ],
    },
    { id: 'meter-backwards', name: '电表倒转', bonds: ['visiShip', 'investShip'], status: 'community', // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
      role: 'economy', archetype: 'cycle', source,
      // Maintainer-provided summaries of the community write-ups. Videos are references, not verified transcripts.
      sources: ['https://www.qieyou.com/content/148509', 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316',
        'https://www.bilibili.com/video/BV126wqzqE7f/', 'https://www.bilibili.com/video/BV1m2wuzfEMA/',
        'https://www.bilibili.com/video/BV1U3yVBtEan/'],
      shopHold: 4, upgradeSchedule: [{ round: 3, level: 2 }, { round: 4, level: 3 }, { round: 6, level: 4 }],
      stages: ['Establish cheap survival and economy members.', 'Activate investors; grow investor/foresight layers before cycling.',
        'Hold the feasible shop level, refresh little, buy cheap useful gain effects; sell only surplus copies.',
        'Feed damage bonds without losing the engine or enemy counters.'],
      preconditions: ['A feasible shop-level hold', 'Distinct investors active', 'A budget/funds source with its actual payout timing'],
      avoid: ['Competing for the same cheap shared pool', 'Early enemy pressure exceeds the survival board'],
      claims: [
        { rule: 'foresightGlobalDiscount', value: 100, version: 'part 1', source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
        { rule: 'investorTriple', value: 70, version: 'part 1', source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
      ],
      eventClaims: [{ operator: '山', event: 'SERVER_GAIN', source: 'https://www.qieyou.com/content/148509' }], // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
      variants: [
        { id: 'yan-victoria', damageBonds: ['yanShip', 'victoriaShip', 'arcaneShip'],
          namedMembers: ['伊桑', '万顷', '林', '山', '琳琅诗怀雅'], package: true, source: 'https://www.qieyou.com/content/148509' }, // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
        { id: 'suzuran-pinus', damageBonds: ['kazimierzShip', 'swiftShip'], namedMembers: ['焰尾'], band: 'band_lisa', // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
          source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
        { id: 'siracusa', damageBonds: ['siracusaShip', 'swiftShip'], namedMembers: ['忍冬'], // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
          source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
        { id: 'kjerag', damageBonds: ['kjeragShip', 'preciShip', 'skillfulShip'], namedMembers: ['雪猎', '银灰'], // i18n-ignore: AI knowledge data (community build / operator names matched against game data), never shown in the UI
          source: 'https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316' },
      ],
    },
  ],
  roles: [
    { band: 'band_ioleta', role: 'safety-net', main: 'steadShip', source,
      advice: 'Cheap elites and three steadfast members can cover a professional team with weak early matchups.' },
    { band: 'band_fang', role: 'supplier', source,
      advice: 'Buy missing professional-team operators for beacon transfer; check the automatic recipient and next-round delivery.' },
  ],
};
