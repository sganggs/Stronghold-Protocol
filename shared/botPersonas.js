// shared/botPersonas.js — preset strategy AI teammates ("预设策略 AI").
//
// Server hosts can seat no persona bot at all (a plain weighted bot is the default), or turn the whole feature
// off with SP_BOT_PERSONAS=0 (the lobby then rejects the persona field and every persona resolves to the default).
//// A persona overrides the default bot's decision weights (server/match/bot.js) in five places:
//   band           the strategy (band) the bot locks in (botPickBand; a teammate that took it first falls back to the
//                  default weighted pick — the draft dedupes bands)
//   levelTarget    shop level aimed for at the start of round r (levelUp; index = round). With a persona this curve is
//                  authoritative: the default "level on 14 spare funds" bail-out never runs past it.
//   levelCap       the bot never levels beyond this (罗素 stays at 2 through round 8; its round-9 phase lifts the cap)
//   levelEager     level as soon as the curve and the funds allow — the default "board full first" gate is skipped
//                  (陈尽早上三本; the fill pass still buys units before every level-up)
//   focus          the bonds to build around (bondPlan focus): a priority list of bond ids — the one with the most
//                  owned members / banked layers wins (owned ≥ 1 required, no flip-flopping). An empty list with
//                  noCoreFocus chases no core bond at all (阿米娅's five-bond breadth).
//   bondPref       per-bond bonus weight in every purchase / lineup bond value (bondValue, bondPlan's second bond)
//   profBonus      per-profession purchase bonus (buyScore; kept below a bond threshold hit so bond layering wins)
//   wanted         per-chess purchase bonus (buyScore; by chessId or baseId) — 陈's named operators
//   eliteBias      lineup bonus per deployed elite (罗素 fields every elite it merges)
//   mergeBonus     extra purchase score for a copy that completes a merge (罗素)
//   items          equipment policy: allow = base item ids always bought, conditional = only when `when` holds
//                  ('refraction': the round's wave has a 折射 enemy), econKeys = economy buff keys bought alongside
//                  the whitelist (陈: economy + 坚守盾牌), carrier = whom an allowed item goes to ('TANK' first,
//                  'AOE' dealers first)
//   phases         optional, ordered: fields of a later phase (fromRound) override the base (bondPref / wanted merge)
//   adaptive       true on 随机应变·兜底: the bot resolves to one of the concrete strategies at the strategy draft
//                  (bot.js resolveAdaptivePersona) — by the match's disabled bonds and the strategies teammates
//                  claimed or intend (already-picked bands, humans' g.bandFocus highlight, preset bots' locked bands).
//
// Strategy constraints shared by all four concrete plans:
//   ① siracusaShip (叙拉古) is a power trap with a hard pivot — its bondPref weight is deeply negative everywhere and
//      罗素's focus drops it. 德克萨斯/普罗旺斯 are the sanctioned exceptions: they enter ONLY through the economy
//      salvage layer (bot.js salvageFunds — buy & instant-sell banks a free refresh; buy & hold fields them a round),
//      never as combat drafts. 坚守/助力 weights are nudged up.
//   ② 善用刷新 (personaRefreshTargets): bonds with bondPref weight ≥ 6 plus the active focus list. A shop that shows
//      none of them (nor a wanted operator, a merge copy or an economy pickup) is rerolled while funds allow —
//      陈's targets are 坚守/助力/精准/灵巧/拉特兰 (its round-8 phase raises 拉特兰), the others' 坚守/助力/灵巧(+各自的叠层方向).
//   ③ 永不同时开启复数个核心盟约 (bot.js bondValue / lineupScore): a core bond other than the focus is penalised —
//      purchases avoid a second core and the lineup never fields an activating second-core trio.
//   ④ economy salvage: leftover funds are lost at prep end — a persona bot converts a doomed 1–2 fund remainder into
//      cross-round value (德克萨斯 sell→+1 free refresh, 普罗旺斯 gain→+1 free refresh, 至简 price 1 carry,
//      见钱眼开玩偶 equip→destroy +2 next round; see bot.js salvageFunds).
//
// Each concrete strategy's PREFERENCE (when 随机应变 adopts it — personaPreferred below):
//   陈        拉特兰 not disabled, 精准+灵巧 not disabled or barely, no teammate on a 拉特兰-leaning band, AND a teammate
//             already on a 前期兜底/阿戈尔 strategy (CHEN_ALLY_BANDS: 阿米娅/罗素/Pith/埃芒加德/克莱门莎/卡莱莎 —
//             拉特兰's six-member payoff is late; it wants the early game covered)
//   Touch     谢拉格 not disabled and no teammate on an 阿戈尔/谢拉格-leaning band (大帝 counts only when its 卡西米尔
//             core bond is disabled)
//   杜遥夜    炎 not disabled (the only Yan-leaning band is its own; 2026-10-07)
//   罗素      坚守+助力 not disabled or barely, and ≥2 of 精准/灵巧/迅捷/奥术 disabled (the scaling bonds are gone)
//   阿米娅    坚守+助力 not disabled or barely — and by resolution order it is taken only when no other qualifies
//
// Data ids verified against data/*.json (bonds: steadShip 坚守, deputShip 助力, skillfulShip 灵巧, preciShip 精准,
// swiftShip 迅捷, arcaneShip 奥术, lateranoShip 拉特兰, kjeragShip 谢拉格, egirShip 阿戈尔, kazimierzShip 卡西米尔,
// yanShip 炎, miraShip 奇迹, siracusaShip 叙拉古; bands: band_amiya 阿米娅, band_amedic Touch, band_chen 陈,
// band_ioleta 伊奥莱塔·罗素, band_duyaoy 杜遥夜, band_damaztic “变形者集群”, band_ermengard 埃芒加德, band_sciurus 休露丝,
// band_clementia 克莱门莎, band_pith Pith, band_qalaisa 卡莱莎, band_jesica 杰西卡, band_emperor 大帝,
// band_paganini 潘格尼尼, band_justin 小贾斯汀; chess: chess_char_3_21_a 空弦, chess_char_3_02_a 断崖,
// chess_char_4_21_a / chess_char_5_16_a 白面鸮, chess_char_6_01_a 蕾缪安, chess_char_6_13_a 新约能天使,
// chess_char_4_13_a 灵知, chess_char_1_03_a 惊蛰, chess_char_2_04_a 小满, chess_char_3_03_a 诗怀雅,
// chess_char_3_04_a 琳琅诗怀雅, chess_char_4_17_a 星熊, chess_char_5_03_a 烛煌, chess_char_5_12_a 夕,
// chess_char_5_23_a 录武官, chess_char_6_03_a 余, chess_char_6_15_a 仇白, chess_char_1_06_a 刺玫;
// items: chess_item_1_02_e_a 坚守盾牌, chess_item_3_08_e_a 奥术法阵, chess_item_4_09_e_a 灼燃维式重锤).

/** Bot shop-level curve: index = round (levelUp clamps rounds past the end to the last entry). */
import { N_ } from './i18n.js';

const LT = (arr) => arr;

export const BOT_PERSONAS = Object.freeze({
  // 阿米娅兜底: level 3 by rounds 5–6 and a long stay there, no core bond — five add-on bonds open as early as
  // possible (三人坚守, 二人助力 first, then 灵巧 / 三人助力 / 精准 by the draws). Drafts 重装 and 医疗 first, then
  // 狙击, never at the cost of bond layering. Equipment: 坚守盾牌 on a 重装, 奥术法阵 (群攻 carrier) only vs 折射.
  amiya_fallback: Object.freeze({
    id: 'amiya_fallback',
    name: N_('阿米娅·兜底'),
    desc: N_('三本停留，快速开启五盟约：优先三人坚守、二人助力，随后灵巧/三人助力/精准；抓牌重装>医疗>狙击'),
    band: 'band_amiya',
    levelTarget: LT([1, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5]),
    levelEager: true,
    noCoreFocus: true,
    focus: [],
    bondPref: { steadShip: 15, deputShip: 13, skillfulShip: 7, preciShip: 7, siracusaShip: -18 },
    profBonus: { TANK: 7, MEDIC: 6, SNIPER: 4 },
    items: {
      allow: ['chess_item_1_02_e_a'],
      conditional: [{ id: 'chess_item_3_08_e_a', when: 'refraction' }],
      carrier: { chess_item_1_02_e_a: 'TANK', chess_item_3_08_e_a: 'AOE' },
    },
  }),

  // Touch兜底 (revised per the guides' consensus — NGA / Bahamut 谢拉格 threads): rounds 1–7 the plain hold-the-line opening —
  // 三人坚守 + 二人助力 + 医疗稳血, with 角峰 (谢拉格+坚守 dual-tag T2 tank, its first buy already stacks 谢拉格+3)
  // taken along the way as the bridge into the pivot. The guides' consensus: the 3-member 谢拉格 layer IS the payoff
  // (谢拉格干员伤害125%, 对寒冷/冻结敌人额外加成 — "6谢纯陷阱, 3谢才是答案"), so do NOT chase six members for its
  // own sake; the engine is 灵知 (the freeze hand — without freezing 初雪/银灰 never stack) + 初雪 / 银灰
  // (freeze-triggered layer stackers), the terminals are 锏 and 圣聆初雪 eating the amp. Round 7 pivots to the
  // 谢拉格 core with 灵知/初雪/银灰 wanted, 灵巧 the natural second direction (灵知 is 灵巧); round 12 adds the
  // terminals with a small 迅捷 lean (锏 is 迅捷).
  touch_fallback: Object.freeze({
    id: 'touch_fallback',
    name: N_('Touch·兜底'),
    desc: N_('前期三人坚守+医疗稳血，顺手收角峰（谢拉格+坚守双户口）；第7回合转谢拉格：灵知冻结、初雪/银灰叠层，灵巧为副方向；后期锏/圣聆初雪吃增伤打输出（不刻意凑六人）'),
    band: 'band_amedic',
    levelTarget: LT([1, 1, 1, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6]),
    levelEager: true,
    noCoreFocus: true,
    focus: [],
    bondPref: { steadShip: 15, deputShip: 13, skillfulShip: 8, preciShip: 5, kjeragShip: 4, siracusaShip: -18 },
    profBonus: { TANK: 7, MEDIC: 6, SNIPER: 4 },
    wanted: {
      chess_char_1_02_a: 10, // 角峰 (T2 重装: 谢拉格+坚守双户口, 首购谢拉格+3 — 前期抗线, 转型后照样计数)
    },
    items: {
      allow: ['chess_item_1_02_e_a'],
      conditional: [{ id: 'chess_item_3_08_e_a', when: 'refraction' }],
      carrier: { chess_item_1_02_e_a: 'TANK', chess_item_3_08_e_a: 'AOE' },
    },
    phases: [Object.freeze({
      fromRound: 7,
      noCoreFocus: false,
      focus: ['kjeragShip'],
      bondPref: { kjeragShip: 14, skillfulShip: 10, steadShip: 8, deputShip: 5, siracusaShip: -18 },
      wanted: {
        chess_char_4_13_a: 18, // 灵知 (冻结手: 叠层与伪永控的前提, 谢拉格+灵巧 — 必抓)
        chess_char_3_14_a: 16, // 初雪 (主叠层手: 范围内敌人冻结时每名20%概率谢拉格+1)
        chess_char_4_22_a: 12, // 银灰 (次叠层手 25%, 本身是能打的前排)
        chess_char_2_05_a: 8,  // 哈洛德 (T3 医疗: 谢拉格人头 + 稳血)
        chess_char_3_11_a: 8,  // 雪猎 (T3 狙击: 谢拉格人头, 首购+6层)
      },
    }), Object.freeze({
      fromRound: 12,
      wanted: {
        chess_char_6_19_a: 16, // 锏 (终端: 吃谢拉格增伤打BOSS, 兼迅捷/卡西米尔)
        chess_char_6_02_a: 16, // 圣聆初雪 (终端法伤, 兼奥术)
      },
      bondPref: { kjeragShip: 14, skillfulShip: 9, swiftShip: 6, steadShip: 6, siracusaShip: -18 },
    })],
  }),

  // 陈兜底 (revised per the guides' consensus — NGA 拉特兰 threads): rounds 1–7 played as a plain hold-the-line
  // team — the guides' consensus is "前期要当自己完全不是拉特兰" (the 3-member Laterano layer only grants ammo, the
  // payoff is the 6-member layer on 4+ cost cards): 三人坚守 + 医疗稳血, cheap Laterano snipers (能天使/送葬人/隐现) and
  // 空弦/断崖 taken along the way. Round 7 pivots to the Laterano core: 圣约送葬人 (the economy engine) + 信仰搅拌机
  // (拉特兰+坚守 double-bond blocker), then a rush to level 6 for 蕾缪安 and 新约能天使 and the six-member 拉特兰 bond.
  // Equipment: economy items plus 坚守盾牌 on a 重装.
  chen_fallback: Object.freeze({
    id: 'chen_fallback',
    name: N_('陈·兜底'),
    desc: N_('前期当普通队：三人坚守+医疗稳血，顺手收本家低费；第8回合转拉特兰，抓圣约送葬人攒经济、信仰搅拌机抗线，后期六本开六人拉特兰；装备拿经济+坚守盾牌'),
    band: 'band_chen',
    levelTarget: LT([1, 1, 2, 3, 3, 3, 4, 4, 4, 5, 6, 6, 6, 6, 6, 6]),
    levelEager: true,
    noCoreFocus: true,
    focus: [],
    bondPref: { steadShip: 12, preciShip: 12, deputShip: 8, skillfulShip: 7, lateranoShip: 6, siracusaShip: -18 },
    profBonus: { TANK: 6, MEDIC: 6, SNIPER: 5 },
    wanted: {
      chess_char_1_06_a: 10, // 刺玫 (T2 医疗, 前期稳血)
      chess_char_2_02_a: 10, // 赫默 (T3 医疗)
      chess_char_4_01_a: 14, // 信仰搅拌机 (拉特兰+坚守 双户口抗线)
      chess_char_5_01_a: 14, // 圣约送葬人 (经济引擎)
      chess_char_3_21_a: 12, // 空弦
      chess_char_3_02_a: 12, // 断崖
      chess_char_4_21_a: 10, // 白面鸮 (T3 医疗)
      chess_char_6_01_a: 18, // 蕾缪安
      chess_char_6_13_a: 18, // 新约能天使
    },
    items: {
      econKeys: ['equip_destory_gain_random_coin', 'gain_coin_when_round_start', 'use_equip_gain_coin_when_next_round_start'],
      allow: ['chess_item_1_02_e_a'],
      carrier: { chess_item_1_02_e_a: 'TANK' },
    },
    phases: [Object.freeze({
      fromRound: 8,
      noCoreFocus: false,
      focus: ['lateranoShip'],
      bondPref: { lateranoShip: 14, steadShip: 8 },
    })],
  }),

  // 罗素兜底 (rewritten per 眠-屿's 一图流 guide — bilibili BV1YmXvBQExf, "精助坚 4.0"):
  // the guides' consensus inverts the old plan — PRECISION is the stacking direction (跃跃/深靛/送葬人/寒芒克洛丝/缇缇
  // are all 精准), 助力 the second (调香师/波登可/刺玫), 坚守 the wall (角峰/古米/蛇屠箱/折桠). Rhythm: rounds 1–5 stay
  // at level 1 and dump every fund into merging the core cards (the guide: "花光最后一块钱进阶…不要花太多钱，优先
  // 升本" — merge first, level after); level 2 around round 6 (its upgrade costs 0 there per the guide) and hold
  // through round 8; from round 9 the phase lifts the cap — three, then four, and STAYS there (不上五本; the
  // guide's "二本后直接速升到四本", 三本 only buys 蛇屠箱). 抓牌: level-1 core ×3 无脑抓 (刺玫/波登可/跃跃/角峰/古米,
  // 深靛 ×1 activates 精准), level-2 core 调香师/送葬人 + 折桠 (road-layer swap), level-3 蛇屠箱 (斯卡蒂 sub, 能天使
  // 2-fund 奇迹 activator), level-4+ 寒芒克洛丝 behind 波登可 / 缇缇 (精准 stacking god) / 魔王 / 引星棘刺 / 白面鸮.
  // The guide's 深巡/隐现/雷蛇 transition cards and 远见投资 are left out (economy salvage covers the former, the
  // latter "效率很鸡肋"). 随身身份牌 (+6 bond layers on equip, no activation needed) joins 坚守盾牌; 奥术法阵 vs 折射.
  // A 助力-less fallback variant was tried during tuning and dropped — with the bond banned the plan degrades
  // gracefully to 精坚 on its own (same-seed HARD bench: 9/20 vs the old strategy's 7/20), so the plan stands as-is.
  ioleta_fallback: Object.freeze({
    id: 'ioleta_fallback',
    name: N_('罗素·兜底'),
    desc: N_('一本死刷精助坚核心（刺玫/波登可/跃跃/角峰/古米×3，深靛激活精准），进阶优先、6回合上二本；二本补调香师/送葬人，9回合起升三本、随后四本驻扎不上五本；叠层方向精准>坚守>助力；装备随身身份牌+坚守盾牌'),
    band: 'band_ioleta',
    levelTarget: LT([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
    levelEager: true,
    levelCap: 2,
    focus: ['preciShip', 'steadShip', 'deputShip'],
    bondPref: { preciShip: 15, steadShip: 13, deputShip: 12, siracusaShip: -18 },
    profBonus: { TANK: 4, MEDIC: 4, SNIPER: 3, SUPPORT: 3 },
    eliteBias: 8,
    mergeBonus: 12,
    wanted: {
      chess_char_1_06_a: 14, // 刺玫 (T1 医疗: 助力 — 一本核心, ×3 无脑抓)
      chess_char_1_13_a: 14, // 波登可 (T1 辅助: 助力 — 一本核心, ×3; 四本后寒芒克洛丝站它背后)
      chess_char_1_09_a: 14, // 跃跃 (T1 狙击: 精准 — 一本核心, ×3)
      chess_char_1_02_a: 14, // 角峰 (T1 重装: 坚守 — 一本核心, ×3)
      chess_char_1_10_a: 14, // 古米 (T1 重装: 坚守 — 一本核心, ×3)
      chess_char_1_17_a: 8,  // 深靛 (T1 术师: 奥术+精准 — ×1 激活精准)
      chess_char_2_14_a: 16, // 调香师 (T2 医疗: 助力 — 二本核心, ×3)
      chess_char_2_01_a: 16, // 送葬人 (T2 狙击: 拉特兰+精准 — 二本核心, ×3)
      chess_char_2_17_a: 10, // 折桠 (T2 重装: 坚守 — 道中叠层, 扛不住/关底换坚守位)
      chess_char_3_16_a: 16, // 蛇屠箱 (T3 重装: 坚守 — 三本核心必抓)
      chess_char_3_05_a: 8,  // 斯卡蒂 (T3 战士: 坚守 — 蛇屠箱下位替代)
      chess_char_3_01_a: 8,  // 能天使 (T3 狙击: 拉特兰+奇迹 — 两块钱激活奇迹)
      chess_char_3_19_a: 6,  // 伺夜 (T3 先锋: 抓不到能天使时拿)
      chess_char_4_06_a: 12, // 寒芒克洛丝 (T4 狙击: 精准 — 放波登可背后)
      chess_char_5_02_a: 14, // 缇缇 (T5 医疗: 精准 — 精准的神, 叠层专用)
      chess_char_5_09_a: 10, // 魔王 (T5 辅助: 奇迹)
      chess_char_5_15_a: 10, // 引星棘刺 (T5 特种)
      chess_char_4_21_a: 8,  // 白面鸮 (T4 医疗: 助力+灵巧)
    },
    items: {
      allow: ['chess_item_1_04_e_a', 'chess_item_1_02_e_a'],
      conditional: [{ id: 'chess_item_3_08_e_a', when: 'refraction' }],
      carrier: {
        chess_item_1_04_e_a: 'TANK', chess_item_1_02_e_a: 'TANK', chess_item_3_08_e_a: 'AOE',
      },
    },
    phases: [Object.freeze({
      fromRound: 9,
      levelCap: 4,
      levelTarget: LT([1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4]),
    })],
  }),
  // 杜遥夜兜底 (per the guides' consensus — NGA 炎 threads): the guides' consensus makes 炎 the
  // T0 "轮椅" faction — 广交豪杰's special refreshes feed a Yan operator every round, so "看到炎基本无脑买" and the
  // 3-member ATK layer (+23% to Yan members) pays from the moment it lights up (unlike 拉特兰's dead 3-layer). The
  // opening is the same hold-the-line transition as the others (三人坚守 + 助力 + 医疗稳血 — "三坚守六回合前无敌"),
  // with every Yan card taken along the way; 杜遥夜's 29 HP funds the guide's fast level curve (2→4→6→8 回合升本).
  // The engine is the second direction 灵巧 (小满; "炎+灵巧+助力 相性非常好") and the six-member layer at rounds
  // 8–9 summons 炎佑 (30% of the Yan fleet's ATK+HP stats, hits 3 targets); 星熊 the iron tank, 夕/烛煌 the T4
  // dealers (灼燃维式重锤 goes to the strongest dealer = 夕/烛煌), 录武官 the medic, 余/仇白 the late blockers.
  duyao_fallback: Object.freeze({
    id: 'duyao_fallback',
    name: N_('杜遥夜·兜底'),
    desc: N_('炎盟约从头吃到尾：坚守+助力+医疗稳血过渡，看到炎就收（广交豪杰每回合定向刷炎）；按2/4/6/8回合快速升本，8-9回合开六炎召唤炎佑，灵巧为副方向；装备拿灼燃重锤+坚守盾牌'),
    band: 'band_duyaoy',
    levelTarget: LT([1, 1, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5]),
    levelEager: true,
    levelCap: 5,
    focus: ['yanShip'],
    bondPref: { yanShip: 12, steadShip: 12, deputShip: 10, skillfulShip: 10, miraShip: 6, siracusaShip: -18 },
    profBonus: { TANK: 6, MEDIC: 5, CASTER: 4 },
    wanted: {
      chess_char_1_06_a: 10, // 刺玫 (T2 医疗, 前期稳血)
      chess_char_1_03_a: 8,  // 惊蛰 (T2 术师: 唯一低费炎, 前期清杂 + 炎人头)
      chess_char_2_04_a: 10, // 小满 (T3 辅助: 炎+灵巧 — 副方向入口)
      chess_char_3_03_a: 8,  // 诗怀雅 (T3 近卫: 炎+远见)
      chess_char_3_04_a: 10, // 琳琅诗怀雅 (T3 特种: 炎+投资人, 每回合发钱)
      chess_char_4_17_a: 12, // 星熊 (T3 重装: "给上饼干天赋星熊就是铁人")
    },
    items: {
      allow: ['chess_item_1_02_e_a', 'chess_item_4_09_e_a'],
      conditional: [{ id: 'chess_item_3_08_e_a', when: 'refraction' }],
      carrier: { chess_item_1_02_e_a: 'TANK', chess_item_3_08_e_a: 'AOE' },
    },
    phases: [Object.freeze({
      fromRound: 6,
      bondPref: { yanShip: 15, skillfulShip: 10, steadShip: 7, deputShip: 6, siracusaShip: -18 },
      wanted: {
        chess_char_5_03_a: 14, // 烛煌 (T4 术师: 炎+维多利亚 双户口, 灼燃重锤载体)
        chess_char_5_12_a: 16, // 夕 (T4 术师: 炎+奥术 — 中期第一优先)
        chess_char_5_23_a: 12, // 录武官 (T4 医疗: 炎+奇迹, "当奶也是有说法的")
        chess_char_6_03_a: 12, // 余 (T4 重装: 炎+坚守 抗线)
        chess_char_6_15_a: 10, // 仇白 (T4 近卫: 炎+突袭 后期输出)
      },
    }), Object.freeze({
      fromRound: 11,
      bondPref: { yanShip: 15, skillfulShip: 9, arcaneShip: 7, steadShip: 5, siracusaShip: -18 },
    })],
  }),
  // 随机应变·兜底: no weights of its own — at the strategy draft (bot.js resolveAdaptivePersona) it reads the match's
  // disabled bonds and the strategies teammates claimed / intend, adopts the best-fitting concrete strategy below
  // (陈 > Touch > 杜遥夜 > 罗素 > 阿米娅 by preference, its own band must still be free), and plays that out. It
  // waits for the humans' picks (Match.scheduleBandBot / bot.js botDefersBand).
  adaptive_fallback: Object.freeze({
    id: 'adaptive_fallback',
    name: N_('随机应变·兜底'),
    desc: N_('让真人先选：等所有真人玩家选完阵营后，根据队友已选/意向策略与当局禁用，自动变为最合适的兜底策略（陈>Touch>杜遥夜>罗素>阿米娅，阿米娅为最终兜底）'),
    band: null,
    adaptive: true,
  }),
});

/**
 * Bands whose strategies draw on the same card pools: a teammate on one of these contests
 * the pool. agorKjerag = 阿戈尔/谢拉格-leaning (大帝 only while its 卡西米尔 core bond is disabled — personaPreferred
 * adds that case), laterano = 拉特兰-leaning.
 */
export const RIVAL_BANDS = Object.freeze({
  agorKjerag: Object.freeze(['band_damaztic', 'band_ermengard', 'band_sciurus', 'band_clementia', 'band_pith',
    'band_qalaisa', 'band_ioleta', 'band_amiya', 'band_jesica']),
  laterano: Object.freeze(['band_paganini', 'band_justin']),
});
/** 大帝 leans 阿戈尔/谢拉格 only when its 卡西米尔 core bond is disabled this match. */
export const EMPEROR_BAND = 'band_emperor';
export const EMPEROR_OFF_BOND = 'kazimierzShip';

/**
 * Bands that count as "the early game is already covered" for 陈's preference: the two 前期兜底
 * strategies (阿米娅's five-bond breadth, 罗素's level-2 elite merge) and the 阿戈尔-leaning strategies (Pith,
 * 埃芒加德, 克莱门莎, 卡莱莎). 陈's Laterano payoff only lands at the six-member layer on 4+ cost cards — it wants a
 * teammate holding the early rounds, so 随机应变 takes it only when one of these is already on the field.
 */
export const CHEN_ALLY_BANDS = Object.freeze([
  'band_amiya', 'band_ioleta', 'band_pith', 'band_ermengard', 'band_clementia', 'band_qalaisa',
]);

/**
 * Whether a concrete strategy's preference holds for this match — the conditions 随机应变·兜底 adopts it under.
 * Pure: the caller (bot.js resolveAdaptivePersona) builds ctx from the live match.
 * @param {object} p a concrete persona from BOT_PERSONAS
 * @param {{ offBonds: Set<string>, bannedChessByBond: Map<string, number>, claimedBands: Set<string> }} ctx
 *   offBonds          bonds disabled this match (drawn + mode-inactive)
 *   bannedChessByBond bondId → number of banned chess belonging to it
 *   claimedBands      bands teammates already picked, highlighted (humans' g.bandFocus) or locked (preset bots)
 */
export function personaPreferred(p, ctx) {
  const off = (b) => ctx.offBonds.has(b);
  const bannedOf = (b) => ctx.bannedChessByBond.get(b) || 0;
  // "未禁或少禁": none of the bonds is off, or at most one is and their banned members stay a trickle
  const fewBans = (bonds) => {
    const offs = bonds.filter(off).length;
    return offs === 0 || (offs <= 1 && bonds.reduce((s, b) => s + bannedOf(b), 0) <= 2);
  };
  const rivals = (group) => [...RIVAL_BANDS[group]].some((b) => ctx.claimedBands.has(b))
    || (ctx.claimedBands.has(EMPEROR_BAND) && off(EMPEROR_OFF_BOND));
  switch (p.id) {
    case 'amiya_fallback': return fewBans(['steadShip', 'deputShip']);
    case 'touch_fallback': return !off('kjeragShip') && !rivals('agorKjerag');
    case 'chen_fallback':
      // the six-member Laterano payoff is late: a teammate must already hold the early game (前期兜底 or 阿戈尔)
      return !off('lateranoShip') && fewBans(['preciShip', 'skillfulShip']) && !rivals('laterano')
        && CHEN_ALLY_BANDS.some((b) => ctx.claimedBands.has(b));
    case 'duyao_fallback': return !off('yanShip');
    case 'ioleta_fallback':
      return fewBans(['steadShip', 'deputShip'])
        && ['preciShip', 'skillfulShip', 'swiftShip', 'arcaneShip'].filter(off).length >= 2;
    default: return false;
  }
}

/** Persona ids in definition order (the lobby validates room.addBot { persona } against this). */
export const PERSONA_IDS = Object.freeze(Object.keys(BOT_PERSONAS));

/**
 * The bonds a persona's shop must show one of to justify a purchase (② 善用刷新): every bondPref entry weighted ≥ 6
 * plus the active focus list. A persona bot rerolls a shop that shows none of them (nor a wanted operator, a merge
 * copy or an economy pickup) while funds allow — 陈's set is 精准/灵巧/拉特兰, the others' 坚守/助力/灵巧 and their
 * stacking directions. Pure: usable from both server and tests.
 */
export function personaRefreshTargets(p) {
  const out = new Set();
  if (p) {
    for (const [b, w] of Object.entries(p.bondPref || {})) if (w >= 6) out.add(b);
    if (!p.noCoreFocus) for (const b of p.focus || []) out.add(b);
  }
  return out;
}

/** A persona by id, or null. */
export function personaById(id) {
  return (typeof id === 'string' && Object.prototype.hasOwnProperty.call(BOT_PERSONAS, id)) ? BOT_PERSONAS[id] : null;
}
