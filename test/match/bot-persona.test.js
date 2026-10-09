// Preset strategy personas (shared/botPersonas.js → bot.js personaOf): the band lock, the level curve / cap, the
// equipment whitelist and the carrier rules, and 随机应变·兜底's preference resolution. The four personas' full
// behaviour is measured by tools/persona-check.mjs; these tests pin the mechanisms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { BOT_PERSONAS, personaPreferred, personaRefreshTargets, CHEN_ALLY_BANDS } from '../../shared/botPersonas.js';
import { LAYER_ENGINES, COMBOS, ANCHOR_TAGS, KJERAG_CHESS, comboCompletionBonus, engineLayerValue } from '../../shared/operatorManual.js';
import {
  botPickBand, personaOf, personaAllowsItem, resolveAdaptivePersona,
  buySellCarrier, salvageFunds, sellEconHold, bridgeEconFunds,
  comboLayoutSteps, runSteps, stackEaseOf, stackTake, fieldModel,
} from '../../server/match/bot.js';
import { pieceDir, legalTiles, positionClass, parseKey } from '../../server/match/board.js';
import { makeMatch } from './harness.js';

/** The four concrete strategies (随机应变 resolves to one of these; MAX_SEATS is 4). */
const CONCRETE = Object.values(BOT_PERSONAS).filter((p) => !p.adaptive);

const personaSeats = () => CONCRETE.map((p, i) => ({
  seat: i, playerId: `ai_${i}`, name: `AI·${p.name}`, isBot: true, connected: true, persona: p.id,
}));

/** A match with one adaptive seat + default bot seats, for resolution tests. */
const adaptiveMatch = (seed) => makeMatch({
  mode: 'coop', difficulty: 'NORMAL', seed,
  seats: [
    { seat: 0, playerId: 'ai_ad', name: 'AI·随机应变', isBot: true, connected: true, persona: 'adaptive_fallback' },
    { seat: 1, playerId: 'ai_x1', name: 'AI·甲', isBot: true, connected: true },
    { seat: 2, playerId: 'ai_x2', name: 'AI·乙', isBot: true, connected: true },
    { seat: 3, playerId: 'ai_x3', name: 'AI·丙', isBot: true, connected: true },
  ],
}).start();

test('persona definitions: every band / bond / chess / item id exists in the game data', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 1 }).start();
  const m = h.m;
  const gd = m.gd;
  try {
    for (const per of CONCRETE) {
      assert.ok(gd.band(per.band), `${per.id}: band ${per.band}`);
      for (const b of Object.keys(per.bondPref || {})) assert.ok(gd.bond(b), `${per.id}: bondPref ${b}`);
      for (const b of per.focus || []) assert.ok(gd.bond(b), `${per.id}: focus ${b}`);
      for (const c of Object.keys(per.wanted || {})) assert.ok(gd.chess(c), `${per.id}: wanted ${c}`);
      const it = per.items || {};
      for (const id of it.allow || []) assert.ok(gd.item(id), `${per.id}: allow ${id}`);
      for (const c of it.conditional || []) assert.ok(gd.item(c.id), `${per.id}: conditional ${c.id}`);
      for (const id of Object.keys(it.carrier || {})) assert.ok(gd.item(id), `${per.id}: carrier ${id}`);
      assert.ok(Array.isArray(per.levelTarget) && per.levelTarget.length >= 15, `${per.id}: level curve covers 15 rounds`);
      for (const [i, lv] of per.levelTarget.entries()) {
        assert.ok(Number.isInteger(lv) && lv >= 1 && lv <= 6, `${per.id}: levelTarget[${i}] = ${lv}`);
        if (i) assert.ok(lv >= per.levelTarget[i - 1], `${per.id}: level curve monotonic`);
      }
      if (Number.isInteger(per.levelCap)) assert.ok(per.levelTarget[per.levelTarget.length - 1] <= per.levelCap, `${per.id}: curve within the cap`);
      // a phase may lift the cap and resume the curve (罗素 from round 9): same shape rules, never below the base
      for (const [f, ph] of (per.phases || []).entries()) {
        for (const b of ph.focus || []) assert.ok(gd.bond(b), `${per.id} phase ${f}: focus ${b}`);
        for (const c of Object.keys(ph.wanted || {})) assert.ok(gd.chess(c), `${per.id} phase ${f}: wanted ${c}`);
        if (Array.isArray(ph.levelTarget)) {
          assert.ok(ph.levelTarget.length >= 15, `${per.id} phase ${f}: level curve covers 15 rounds`);
          for (const [i, lv] of ph.levelTarget.entries()) {
            assert.ok(Number.isInteger(lv) && lv >= 1 && lv <= 6, `${per.id} phase ${f}: levelTarget[${i}] = ${lv}`);
            if (i) assert.ok(lv >= ph.levelTarget[i - 1], `${per.id} phase ${f}: level curve monotonic`);
            assert.ok(lv >= per.levelTarget[i], `${per.id} phase ${f}: curve never drops below the base`);
          }
          const pcap = Number.isInteger(ph.levelCap) ? ph.levelCap : (Number.isInteger(per.levelCap) ? per.levelCap : 6);
          assert.ok(ph.levelTarget[ph.levelTarget.length - 1] <= pcap, `${per.id} phase ${f}: curve within the phase cap`);
          if (Number.isInteger(ph.levelCap) && Number.isInteger(per.levelCap)) {
            assert.ok(ph.levelCap >= per.levelCap, `${per.id} phase ${f}: the cap only ever lifts`);
          }
        }
      }
    }
    for (const b of CHEN_ALLY_BANDS) assert.ok(gd.band(b), `CHEN_ALLY_BANDS: band ${b}`);
  } finally { m.dispose(); }
});

test('persona: the band locks in (a taken one falls back to the default weighted pick)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 7 }).start();
  const m = h.m;
  try {
    const ps = [...m.players.values()].find((p) => p.botPersona === 'chen_fallback');
    assert.equal(botPickBand(m, ps), 'band_chen');
    // the same strategy a teammate already took (the draft's pick table): the persona steps aside
    const other = [...m.players.values()].find((p) => p !== ps);
    m.draft = { picks: { [other.playerId]: 'band_chen' } };
    assert.notEqual(botPickBand(m, ps), 'band_chen');
    // no persona on the seat: personaOf is null and the default path is untouched
    other.botPersona = null;
    assert.equal(personaOf(m, other), null);
  } finally { m.dispose(); }
});

test('persona: the level curve is followed and the cap holds (罗素 stays at 2 through round 8, then lifts)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 7 }).start();
  const m = h.m;
  try {
    let last = '';
    let ioletaR8 = 0;
    h.run(() => {
      const key = `${m.phase}:${m.round}`;
      if (key !== last && m.phase === PHASE.PREP) {
        last = key;
        for (const ps of m.players.values()) {
          // phase-merged (罗素's round-9 phase lifts the cap and resumes the curve)
          const per = personaOf(m, ps) || BOT_PERSONAS[ps.botPersona];
          const cap = Number.isInteger(per.levelCap) ? per.levelCap : 6;
          assert.ok(ps.shop.level <= cap, `${per.name} R${m.round}: level ${ps.shop.level} > cap ${cap}`);
          assert.ok(ps.shop.level <= per.levelTarget[Math.min(per.levelTarget.length - 1, m.round)] + 1,
            `${per.name} R${m.round}: level ${ps.shop.level} runs ahead of its curve`);
          if (ps.botPersona === 'ioleta_fallback' && m.round === 8) ioletaR8 = ps.shop.level;
        }
      }
      return h.ended != null;
    }, { maxSteps: 5e6 });
    assert.equal(m.errorCount, 0, 'no sim errors');
    assert.equal(ioletaR8, 2, '罗素 stays at level 2 through round 8');
    const ioleta = [...m.players.values()].find((p) => p.botPersona === 'ioleta_fallback');
    assert.ok(ioleta.shop.level >= 3, `罗素 lifted the cap from round 9 (level ${ioleta.shop.level})`);
    assert.ok(ioleta.shop.level <= 4, `罗素 within its phase cap 4 — 不上五本 (level ${ioleta.shop.level})`);
    const chen = [...m.players.values()].find((p) => p.botPersona === 'chen_fallback');
    assert.ok(chen.shop.level >= 3, `陈 is on its way up (level ${chen.shop.level})`);
  } finally { m.dispose(); }
});

test('persona: the equipment whitelist — 阿米娅 takes 坚守盾牌, nothing else; 奥术法阵 only vs 折射; 陈 economy items + 坚守盾牌', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 7 }).start();
  const m = h.m;
  const gd = m.gd;
  try {
    const by = (id) => [...m.players.values()].find((p) => p.botPersona === id);
    const amiya = by('amiya_fallback');
    const chen = by('chen_fallback');
    const SHIELD = 'chess_item_1_02_e_a';   // 坚守盾牌
    const ARRAY = 'chess_item_3_08_e_a';    // 奥术法阵
    const HAMMER = 'chess_item_1_01_e_a';   // 维式重锤 (a plain stat item, not whitelisted)
    const COIN = 'chess_item_1_03_e_a';     // 盟约之币 (economy)
    // the golden variant of an allowed item counts as its base (baseIdOf strips the _b suffix)
    assert.equal(personaAllowsItem(m, amiya, 'chess_item_1_02_e_b'), true);
    assert.equal(personaAllowsItem(m, amiya, SHIELD), true);
    assert.equal(personaAllowsItem(m, amiya, HAMMER), false);
    // 奥术法阵 only while the round's wave holds a 折射 enemy
    const wave = m.wave;
    m.wave = null;
    const noFoe = { ...(gd.wave(Object.keys(gd.raw.waves)[0])) };
    m.wave = { ...noFoe, spawns: [] };
    assert.equal(personaAllowsItem(m, amiya, ARRAY), false);
    m.wave = wave;
    // 陈: economy buff keys plus the 坚守盾牌 whitelist entry (the two modes stack)
    assert.equal(personaAllowsItem(m, chen, COIN), true);
    assert.equal(personaAllowsItem(m, chen, SHIELD), true);
    assert.equal(personaAllowsItem(m, chen, 'chess_item_1_02_e_b'), true, '金坚守盾牌 counts as its base');
    assert.equal(personaAllowsItem(m, chen, ARRAY), false, '陈 does not take 奥术法阵');
    assert.equal(personaAllowsItem(m, chen, HAMMER), false);
    // 杜遥夜: 坚守盾牌 + 灼燃维式重锤 (the guides' core Yan item), nothing else
    const duyao = by('duyao_fallback');
    assert.equal(personaAllowsItem(m, duyao, SHIELD), true);
    assert.equal(personaAllowsItem(m, duyao, 'chess_item_4_09_e_a'), true, '灼燃维式重锤');
    assert.equal(personaAllowsItem(m, duyao, HAMMER), false, '普通维式重锤不在白名单');
    // a default bot (no persona) may buy anything
    const plain = [...m.players.values()].find((p) => !p.botPersona) || amiya;
    plain.botPersona = null;
    assert.equal(personaAllowsItem(m, plain, HAMMER), true);
  } finally { m.dispose(); }
});

// ---- 随机应变·兜底 (adaptive_fallback) ---------------------------------------------------------------------------

const P = BOT_PERSONAS;
const ctx = ({ off = [], claimed = [], banned = [] } = {}) => ({
  offBonds: new Set(off),
  bannedChessByBond: new Map(banned),
  claimedBands: new Set(claimed),
});

test('adaptive: personaPreferred — the five strategies\' preference conditions', () => {
  // 陈: 拉特兰 on, 精准+灵巧 healthy, no 拉特兰-leaning rival, AND a 前期兜底/阿戈尔 teammate already on the field
  const ALLY = ['band_ermengard'];
  assert.equal(personaPreferred(P.chen_fallback, ctx()), false, '场上无前期兜底/阿戈尔队友');
  assert.equal(personaPreferred(P.chen_fallback, ctx({ claimed: ALLY })), true);
  assert.equal(personaPreferred(P.chen_fallback, ctx({ claimed: ['band_amiya'] })), true, '阿米娅兜底在场');
  assert.equal(personaPreferred(P.chen_fallback, ctx({ claimed: ['band_ioleta'] })), true, '罗素兜底在场');
  assert.equal(personaPreferred(P.chen_fallback, ctx({ claimed: ['band_qalaisa'] })), true, '卡莱莎阿戈尔在场');
  assert.equal(personaPreferred(P.chen_fallback, ctx({ claimed: ALLY, off: ['lateranoShip'] })), false, '拉特兰被禁');
  assert.equal(personaPreferred(P.chen_fallback, ctx({ claimed: [...ALLY, 'band_paganini'] })), false, '潘格尼尼在场');
  assert.equal(personaPreferred(P.chen_fallback, ctx({ claimed: [...ALLY, 'band_justin'] })), false, '小贾斯汀在场');
  assert.equal(personaPreferred(P.chen_fallback, ctx({ claimed: ALLY, off: ['preciShip'] })), true, '精准少禁仍可');
  assert.equal(personaPreferred(P.chen_fallback, ctx({ claimed: ALLY, off: ['preciShip', 'skillfulShip'] })), false, '精准+灵巧双禁');
  // Touch: 谢拉格 on, no 阿戈尔/谢拉格-leaning rival
  assert.equal(personaPreferred(P.touch_fallback, ctx()), true);
  assert.equal(personaPreferred(P.touch_fallback, ctx({ off: ['kjeragShip'] })), false, '谢拉格被禁');
  assert.equal(personaPreferred(P.touch_fallback, ctx({ claimed: ['band_sciurus'] })), false, '休露丝在场');
  assert.equal(personaPreferred(P.touch_fallback, ctx({ claimed: ['band_amiya'] })), false, '阿米娅在场');
  assert.equal(personaPreferred(P.touch_fallback, ctx({ claimed: ['band_emperor'] })), true, '大帝不算（卡西米尔未禁）');
  assert.equal(personaPreferred(P.touch_fallback, ctx({ claimed: ['band_emperor'], off: ['kazimierzShip'] })), false, '卡西米尔被禁时大帝算对手');
  // 杜遥夜: 炎 on (the only Yan-leaning band is its own — a claimed one is skipped by resolution, not preference)
  assert.equal(personaPreferred(P.duyao_fallback, ctx()), true);
  assert.equal(personaPreferred(P.duyao_fallback, ctx({ off: ['yanShip'] })), false, '炎被禁');
  assert.equal(personaPreferred(P.duyao_fallback, ctx({ off: ['skillfulShip', 'steadShip'] })), true, '副方向被禁仍可');
  // 罗素: 坚守+助力 healthy AND ≥2 of 精准/灵巧/迅捷/奥术 disabled
  assert.equal(personaPreferred(P.ioleta_fallback, ctx()), false, '无禁不选罗素');
  assert.equal(personaPreferred(P.ioleta_fallback, ctx({ off: ['preciShip'] })), false, '只禁一个不够');
  assert.equal(personaPreferred(P.ioleta_fallback, ctx({ off: ['preciShip', 'swiftShip'] })), true);
  assert.equal(personaPreferred(P.ioleta_fallback, ctx({ off: ['steadShip', 'deputShip'] })), false, '坚守助力双禁');
  // 阿米娅: 坚守+助力 healthy (the last resort by resolution order)
  assert.equal(personaPreferred(P.amiya_fallback, ctx()), true);
  assert.equal(personaPreferred(P.amiya_fallback, ctx({ off: ['steadShip'] })), true, '坚守少禁仍可');
  assert.equal(personaPreferred(P.amiya_fallback, ctx({ off: ['steadShip', 'deputShip'] })), false);
  // the adaptive persona itself has no preference conditions
  assert.equal(personaPreferred(P.adaptive_fallback, ctx()), false);
});

test('adaptive: resolution — ally present takes 陈, bans and rivals step down the order', () => {
  const h = adaptiveMatch(3);
  const m = h.m;
  try {
    const ad = [...m.players.values()].find((p) => p.botPersona === 'adaptive_fallback');
    const others = [...m.players.values()].filter((p) => p !== ad);
    const setOff = (...bonds) => { m.disabledBonds = bonds; m.bannedChess = []; };
    const claim = (ps, band) => { ps.bandId = band; };
    const reset = () => { claim(others[0]); claim(others[1]); claim(others[2]); };

    // nothing disabled, a teammate on an 阿戈尔 strategy (埃芒加德): 陈 (its 前期兜底/阿戈尔 ally condition holds)
    setOff();
    reset();
    claim(others[2], 'band_ermengard');
    assert.equal(resolveAdaptivePersona(m, ad), 'chen_fallback');

    // no 前期兜底/阿戈尔 teammate on the field: 陈's preference fails → Touch
    setOff();
    reset();
    assert.equal(resolveAdaptivePersona(m, ad), 'touch_fallback');

    // 拉特兰被禁 → Touch
    setOff('lateranoShip');
    assert.equal(resolveAdaptivePersona(m, ad), 'touch_fallback');

    // a teammate picked 潘格尼尼 (拉特兰-leaning) → 陈 skipped → Touch
    setOff();
    claim(others[0], 'band_paganini');
    assert.equal(resolveAdaptivePersona(m, ad), 'touch_fallback');

    // 陈's band taken by a teammate → Touch
    setOff();
    claim(others[0], 'band_chen');
    assert.equal(resolveAdaptivePersona(m, ad), 'touch_fallback');

    // 陈's band and Touch's band taken by teammates → 杜遥夜 (炎 on, nothing else needed)
    setOff();
    claim(others[0], 'band_chen');
    claim(others[1], 'band_amedic');
    assert.equal(resolveAdaptivePersona(m, ad), 'duyao_fallback');

    // 杜遥夜's band taken too (炎 leans on nothing else) → 阿米娅 (the breadth fallback)
    setOff();
    claim(others[0], 'band_chen');
    claim(others[1], 'band_amedic');
    claim(others[2], 'band_duyaoy');
    assert.equal(resolveAdaptivePersona(m, ad), 'amiya_fallback');

    // 拉特兰+谢拉格+炎被禁 and 精准+迅捷 heavily banned → 罗素
    setOff('lateranoShip', 'kjeragShip', 'yanShip', 'preciShip', 'swiftShip');
    claim(others[0]); claim(others[1]);
    assert.equal(resolveAdaptivePersona(m, ad), 'ioleta_fallback');

    // every strategy's band is claimed → null (the default weighted bot)
    setOff();
    claim(others[0], 'band_chen');
    claim(others[1], 'band_amedic');
    claim(others[2], 'band_ioleta');
    ad.bandId = null;
    others[2].botPersona = 'amiya_fallback'; // claims band_amiya via the preset lock
    m.draft = { picks: { [others[0].playerId]: 'band_duyaoy' }, focus: new Map() }; // 杜遥夜 claimed via the pick table
    assert.equal(resolveAdaptivePersona(m, ad), null);
  } finally { m.dispose(); }
});

test('adaptive: a human\'s highlighted band (g.bandFocus) counts as claimed; the resolution sticks', () => {
  const h = adaptiveMatch(5);
  const m = h.m;
  try {
    const ad = [...m.players.values()].find((p) => p.botPersona === 'adaptive_fallback');
    const others = [...m.players.values()].filter((p) => p !== ad);
    m.disabledBonds = [];
    m.bannedChess = [];
    m.draft = { picks: {}, focus: new Map([[others[0].playerId, 'band_paganini']]) };
    assert.equal(resolveAdaptivePersona(m, ad), 'touch_fallback', '潘格尼尼高亮 → 陈 skipped');
    // personaOf resolves once and caches: the strategy (and its band) is fixed for the match
    const per = personaOf(m, ad);
    assert.equal(per.id, 'touch_fallback');
    assert.equal(botPickBand(m, ad), 'band_amedic');
    // later context changes do not flip it
    m.draft = { picks: { [others[0].playerId]: 'band_amedic' }, focus: new Map() };
    assert.equal(personaOf(m, ad).id, 'touch_fallback');
    assert.equal(ps_band(ad), 'band_amedic', 'already locked in');
    // two adaptive seats never share a strategy: the picked band of the first claims it for the second
    const ad2 = others[0];
    ad2.botPersona = 'adaptive_fallback';
    ad2._adaptivePersona = null;
    others[2].bandId = 'band_pith'; // a 前期兜底/阿戈尔 teammate: 陈's ally condition holds for the second resolve
    assert.equal(resolveAdaptivePersona(m, ad2), 'chen_fallback');
  } finally { m.dispose(); }
});

test('adaptive: the 随机应变 bot lets the humans pick first (moves to the back of the draft order)', () => {
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', seed: 11,
    seats: [
      { seat: 0, playerId: 'p_0', name: '博士', isBot: false, connected: true },
      { seat: 1, playerId: 'ai_ad', name: 'AI·随机应变', isBot: true, connected: true, persona: 'adaptive_fallback' },
    ],
  }).start();
  const m = h.m;
  try {
    m.handle('p_0', { t: 'g.infoReady' });
    h.sched.advance(2);
    assert.equal(m.phase, PHASE.BAND_DRAFT);
    const ad = h.ps('ai_ad');
    const d = m.draft;
    // whatever the shuffled order, the adaptive seat never picks while the human hasn't: it sits at the back
    h.run(() => m.draftTurn() === 'p_0', { maxSteps: 500 });
    assert.equal(m.draftTurn(), 'p_0', 'the human\'s turn is up');
    assert.ok(!d.picks[ad.playerId], '随机应变 has not picked yet');
    assert.equal(d.order[d.order.length - 1], ad.playerId, 'the deferred seat sits at the back of the order');
    assert.equal(d.skipsLeft[ad.playerId], m.gd.bandDraft.skipsPerPlayer, 'the reorder spends no skip quota');
    // the human takes 陈's band — the resolve now sees it and steps down to Touch
    assert.deepEqual(m.handle('p_0', { t: 'g.band', bandId: 'band_chen' }), { ok: true });
    h.run(() => m.phase !== PHASE.BAND_DRAFT, { maxSteps: 500 });
    assert.ok(d.picks[ad.playerId], '随机应变 picked after the human');
    assert.equal(ad._adaptivePersona, 'touch_fallback', 'resolved after the human (陈 was taken)');
    assert.equal(ad.bandId, 'band_amedic');
  } finally { m.dispose(); }
});

function ps_band(ps) { return BOT_PERSONAS[ps._adaptivePersona]?.band ?? null; }

// ---- owner constraints 2026-10-06: 叙拉古降权 / 善用刷新 / 永不开双核心 / 经济挽救 ---------------------------------

test('constraints: every strategy demotes 叙拉古 and keeps 坚守/助力 on top; refresh targets follow', () => {
  for (const per of CONCRETE) {
    assert.ok((per.bondPref?.siracusaShip ?? 0) <= -10, `${per.id}: 叙拉古 deeply demoted`);
    // 陈's early hold-the-line is 坚守 first, 助力 a light add-on (8: 白面鸮/刺玫's tag)
    if (per.id !== 'chen_fallback') {
      assert.ok((per.bondPref?.steadShip ?? 0) >= 12, `${per.id}: 坚守 weighted up`);
      assert.ok((per.bondPref?.deputShip ?? 0) >= 10, `${per.id}: 助力 weighted up`);
    } else {
      assert.ok((per.bondPref?.steadShip ?? 0) >= 12, `${per.id}: 坚守 weighted up (前期稳血)`);
    }
    const t = personaRefreshTargets(per);
    assert.ok(!t.has('siracusaShip'), `${per.id}: 叙拉古 is never a refresh target`);
    assert.ok(t.has('steadShip'), `${per.id}: 坚守 targeted`);
  }
  // 陈's set spans 坚守/助力/精准/灵巧 + 拉特兰 (its round-8 phase raises 拉特兰 to 14); the others stack 坚守/助力
  const t = (id) => [...personaRefreshTargets(BOT_PERSONAS[id])].sort();
  assert.deepEqual(t('chen_fallback'), ['deputShip', 'lateranoShip', 'preciShip', 'skillfulShip', 'steadShip']);
  assert.deepEqual(t('amiya_fallback'), ['deputShip', 'preciShip', 'skillfulShip', 'steadShip']);
  assert.deepEqual(t('ioleta_fallback'), ['deputShip', 'preciShip', 'steadShip']);
  assert.deepEqual(t('touch_fallback'), ['deputShip', 'skillfulShip', 'steadShip']);
  // 杜遥夜: 炎 (its core, from round 1) + the hold-the-line transition + 灵巧/奇迹
  assert.deepEqual(t('duyao_fallback'), ['deputShip', 'miraShip', 'skillfulShip', 'steadShip', 'yanShip']);
  // 罗素's focus drops 叙拉古: it is no stacking direction any more
  assert.ok(!BOT_PERSONAS.ioleta_fallback.focus.includes('siracusaShip'));
});

test('constraints: a full match never activates a second core bond for any strategy', () => {
  for (const seed of [7, 42]) {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed }).start();
    const m = h.m;
    try {
      h.run(() => h.ended != null, { maxSteps: 5e6 });
      assert.equal(m.errorCount, 0, `seed ${seed}: no sim errors`);
      for (const ps of m.players.values()) {
        const per = BOT_PERSONAS[ps.botPersona];
        if (!per || per.adaptive) continue;
        const cores = Object.entries(ps.bonds || {}).filter(([id, b]) => b.active && m.gd.bond(id)?.isCore).map(([id]) => id);
        assert.ok(cores.length <= 1, `${per.name} (seed ${seed}): activated ${cores.length} core bonds (${cores.join(',')})`);
        const siracusa = (ps.bonds?.siracusaShip?.active ? ps.bonds.siracusaShip.count : 0);
        assert.ok(siracusa === 0, `${per.name} (seed ${seed}): 叙拉古 activated ×${siracusa}`);
      }
    } finally { m.dispose(); }
  }
});

test('salvage: a stranded 2-fund remainder holds a refresh carrier; the next prep banks it', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 7 }).start();
  const m = h.m;
  const gd = m.gd;
  try {
    h.run(() => m.phase === PHASE.PREP); // the action gate only opens in PREP
    const ps = [...m.players.values()].find((p) => p.botPersona === 'amiya_fallback');
    // a shop that only shows 德克萨斯, funds 2 — the doomed remainder buys the carrier (kept for combat)
    ps.shop.slots = [
      { kind: 'chess', id: 'chess_char_1_08_a', basePrice: gd.chessPrice('chess_char_1_08_a'), frozen: false, sold: false },
      null, null, null, null, null,
    ];
    ps.funds = 2;
    const held = ps._econHold?.length ?? 0;
    salvageFunds(m, ps);
    assert.equal(ps.funds, 0, 'the 2 funds went into the carrier');
    assert.equal((ps._econHold || []).length, held + 1, 'the carrier is held for a later sale');
    const uid = ps._econHold.at(-1);
    assert.equal(ps.find(uid)?.piece?.kind, 'chess', 'the carrier waits on the bench');
    // next prep: selling it pays 1 fund and — 德克萨斯's garrison — 1 banked free refresh
    const free = ps.shop.freeRefreshes;
    const funds = ps.funds;
    const sold = sellEconHold(m, ps);
    assert.equal(sold, 1);
    assert.equal(ps.funds, funds + 1, 'sell price 1');
    assert.equal(ps.shop.freeRefreshes, free + 1, '德克萨斯 banks a free refresh on sale');
    assert.equal(ps._econHold.length, 0);
  } finally { m.dispose(); }
});

test('salvage: 1 fund → the doll (+2 next round) when a carrier exists, 至简 carry otherwise', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 7 }).start();
  const m = h.m;
  const gd = m.gd;
  try {
    h.run(() => m.phase === PHASE.PREP);
    const ps = [...m.players.values()].find((p) => p.botPersona === 'ioleta_fallback');
    // a deployed chess with a free equipment slot: the doll is bought AND equipped (destroyed, +2 next round)
    const anyChess = [...ps.board.values()].find((p) => p.kind === 'chess');
    if (anyChess) {
      ps.shop.slots = [
        { kind: 'item', id: 'chess_item_2_07_e_a', basePrice: gd.itemPrice('chess_item_2_07_e_a'), frozen: false, sold: false },
        null, null, null, null, null,
      ];
      ps.funds = 1;
      anyChess.items = [];
      salvageFunds(m, ps);
      assert.equal(ps.funds, 0, 'the last fund bought the doll');
      assert.equal(ps.hand.filter(Boolean).filter((p) => p.kind === 'item').length, 0, 'the doll destroyed itself on equip');
    }
    // no carrier / no doll: 至简 (price 1, sells 1) carries the fund across rounds
    ps.shop.slots = [
      { kind: 'chess', id: 'chess_char_3_13_a', basePrice: gd.chessPrice('chess_char_3_13_a'), frozen: false, sold: false },
      null, null, null, null, null,
    ];
    ps.funds = 1;
    const held = ps._econHold?.length ?? 0;
    salvageFunds(m, ps);
    assert.equal(ps.funds, 0, '至简 garrison prices it at 1');
    assert.equal((ps._econHold || []).length, held + 1, '至简 held');
    const uid = ps._econHold.at(-1);
    const funds = ps.funds;
    sellEconHold(m, ps);
    assert.equal(ps.funds, funds + 1, '至简 sells back for 1: the fund crossed the round');
    assert.ok(!ps.find(uid));
  } finally { m.dispose(); }
});

test('salvage: a level-up that would strand 1 fund banks a free refresh instead (buy 德克萨斯, sell it back)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 7 }).start();
  const m = h.m;
  const gd = m.gd;
  try {
    h.run(() => m.phase === PHASE.PREP);
    const ps = [...m.players.values()].find((p) => p.botPersona === 'amiya_fallback');
    // level 1→2 under 阿米娅's curve (round 4): funds = price + 1 would strand the 1
    const price = Math.max(0, ps.shop.upgradePrice);
    ps.shop.slots = [
      { kind: 'chess', id: 'chess_char_1_08_a', basePrice: gd.chessPrice('chess_char_1_08_a'), frozen: false, sold: false },
      null, null, null, null, null,
    ];
    ps.funds = price + 1;
    const free = ps.shop.freeRefreshes;
    const carrier = buySellCarrier(m, ps);
    assert.ok(carrier, 'the carrier was bought and sold back');
    assert.equal(ps.funds, price, 'net cost 1: the stranded fund became the refresh');
    assert.equal(ps.shop.freeRefreshes, free + 1, 'a banked free refresh (persists across rounds)');
    // a persona-less bot never does this — no carrier churn for the default weighted bot
    const plain = [...m.players.values()].find((p) => !p.botPersona) || ps;
    const wasPersona = plain.botPersona;
    plain.botPersona = null;
    ps.shop.slots[0] = { kind: 'chess', id: 'chess_char_1_08_a', basePrice: gd.chessPrice('chess_char_1_08_a'), frozen: false, sold: false };
    const _f2 = plain.shop.freeRefreshes;
    plain.funds = 3;
    salvageFunds(m, plain);
    assert.equal(plain.funds, 3, 'a default bot keeps its funds (no salvage)');
    plain.botPersona = wasPersona;
  } finally { m.dispose(); }
});

test('salvage: held economy chess bridge a 1-fund gap for a pickup the shop just showed', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 7 }).start();
  const m = h.m;
  const gd = m.gd;
  try {
    h.run(() => m.phase === PHASE.PREP);
    const ps = [...m.players.values()].find((p) => p.botPersona === 'touch_fallback');
    // hold a 至简 (1 fund carried), then a 2-cost wanted card shows with only 1 fund in hand
    ps.shop.slots = [
      { kind: 'chess', id: 'chess_char_3_13_a', basePrice: gd.chessPrice('chess_char_3_13_a'), frozen: false, sold: false },
      null, null, null, null, null,
    ];
    ps.funds = 1;
    salvageFunds(m, ps);
    assert.ok(ps._econHold.length === 1);
    ps.funds = 1;
    const ok = bridgeEconFunds(m, ps, 2);
    assert.ok(ok, 'the held carry covered the gap');
    assert.equal(ps.funds, 2, '至简 sold for 1');
    assert.equal(ps._econHold.length, 0);
  } finally { m.dispose(); }
});

// ---- operator manual (shared/operatorManual.js): 干员被动知识库 + 组合 ----------------------------------------------

test('manual: every engine / combo / econ chess id and bond id exists in the game data', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 3 }).start();
  const m = h.m;
  const gd = m.gd;
  try {
    const chessOk = (id) => !!gd.chess(id);
    for (const [id, e] of Object.entries(LAYER_ENGINES)) {
      assert.ok(chessOk(id), `engine ${id} (${e.name}) is not a chess id`);
      for (const eff of e.effects || []) {
        if (!Array.isArray(eff.bonds)) continue;
        for (const b of eff.bonds) assert.ok(!!gd.bond(b), `${e.name} stacks unknown bond ${b}`);
      }
    }
    for (const c of COMBOS) {
      assert.ok(chessOk(c.follower), `combo ${c.id}: follower ${c.follower} unknown`);
      if (typeof c.anchor === 'string' && c.anchor.startsWith('chess_')) assert.ok(chessOk(c.anchor), `combo ${c.id}: anchor ${c.anchor} unknown`);
      for (const b of c.bonds || []) assert.ok(!!gd.bond(b), `combo ${c.id}: unknown bond ${b}`);
    }
    for (const id of ANCHOR_TAGS.battleEngine) assert.ok(chessOk(id), `battleEngine tag id ${id} unknown`);
    for (const id of KJERAG_CHESS) assert.ok(chessOk(id), `kjerag set id ${id} unknown`);
    // every id in the kjerag set really is a kjerag chess (completeness was verified against data/chess.json
    // offline: 12 non-golden kjerag operators, 2026-10-06)
    for (const id of KJERAG_CHESS) {
      assert.ok((gd.chess(id)?.bonds || []).includes('kjeragShip'), `${id} in KJERAG_CHESS is not a 谢拉格 chess`);
    }
  } finally { m.dispose(); }
});

test('manual: engineLayerValue follows the persona bond weights', () => {
  const steadHeavy = { bondWeight: (b) => (b === 'steadShip' ? 15 : b === 'siracusaShip' ? -18 : 5) };
  // 折桠 (坚守+4/回合) is the premier 坚守 engine for a 坚守-heavy persona; before 坚守 activates it earns
  // half (the engine rides along, the layers only land once the bond is live)
  const zheya = engineLayerValue('chess_char_2_17_a', steadHeavy);
  assert.ok(zheya >= 2.9 && zheya <= 3.1, `折桠 before 坚守 activates: ${zheya} (half value)`);
  const zheyaLive = engineLayerValue('chess_char_2_17_a', { ...steadHeavy, activeBonds: new Set(['steadShip']) });
  assert.ok(zheyaLive >= 5.9 && zheyaLive <= 6.1, `折桠 with 坚守 active: ${zheyaLive}`);
  // a demoted bond never earns engine value
  const siracusaEngine = engineLayerValue('chess_char_2_16_a', steadHeavy); // 拉普兰德: 叙拉古 on refresh
  assert.equal(siracusaEngine, 0, '叙拉古 engine under a demoting persona is worth 0');
  // unknown operators are simply 0
  assert.equal(engineLayerValue('chess_char_1_01_a', steadHeavy), 0);
});

test('manual: comboCompletionBonus only fires with the partner in hand', () => {
  const empty = new Set();
  assert.equal(comboCompletionBonus('chess_char_5_10_a', empty, false), 0, '铃兰 alone: no bonus');
  const withFlametail = new Set(['chess_char_4_19_a']);
  const suzuran = comboCompletionBonus('chess_char_5_10_a', withFlametail, false);
  assert.ok(suzuran > 0, '铃兰 with 焰尾 in hand earns the combo bonus');
  const bmk = comboCompletionBonus('chess_char_4_21_a', new Set(['chess_char_3_21_a']), false);
  assert.ok(bmk > 0, '白面鸮 with 空弦 in hand earns the combo bonus');
  // a tag anchor (battleEngine) counts any owned battle engine as the partner
  const mora = comboCompletionBonus('chess_char_4_25_a', new Set(['chess_char_3_05_a']), false);
  assert.ok(mora > 0, '魔王 with a battle engine (斯卡蒂) in hand earns the combo bonus');
});

test('manual: comboLayoutSteps seats the follower behind its anchor (persona only)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 3 }).start();
  const m = h.m;
  try {
    h.run(() => m.phase === PHASE.PREP);
    const ps = [...m.players.values()].find((p) => p.botPersona === 'amiya_fallback');
    // grant a 白面鸮 + 空弦 pair and deploy them far apart
    const ow = ps.acquireChess('chess_char_4_21_a');
    const ks = ps.acquireChess('chess_char_3_21_a');
    assert.ok(ow && ks, 'acquireChess succeeded (piece objects)');
    const findUid = (id) => [...ps.allChess()].find((p) => m.gd.baseIdOf(p.id) === id)?.uid;
    const owUid = findUid('chess_char_4_21_a');
    const ksUid = findUid('chess_char_3_21_a');
    assert.ok(owUid && ksUid, 'both pieces are owned');
    // put 空弦 on the first tile legal for a sniper, 白面鸮 far away on a tile legal for a medic
    const map = ps.deployMap();
    const ksFree = legalTiles(map, positionClass(m.gd.chess('chess_char_3_21_a'))).filter(([r, c]) => !ps.board.has(`${r},${c}`));
    const owFree = legalTiles(map, positionClass(m.gd.chess('chess_char_4_21_a'))).filter(([r, c]) => !ps.board.has(`${r},${c}`));
    assert.ok(ksFree.length && owFree.length, 'legal free tiles exist');
    const [kr, kc] = ksFree[0];
    const [wr, wc] = owFree[owFree.length - 1];
    assert.ok(Math.abs(wr - kr) + Math.abs(wc - kc) > 2, 'the pair starts far apart');
    assert.ok(ps.move(ksUid, { area: 'board', row: kr, col: kc }, 'RIGHT').ok, '空弦 placed');
    assert.ok(ps.move(owUid, { area: 'board', row: wr, col: wc }, 'RIGHT').ok, '白面鸮 placed');
    runSteps(comboLayoutSteps(m, ps));
    const kw = ps.find(ksUid);
    const ww = ps.find(owUid);
    assert.equal(kw.area, 'board');
    assert.equal(ww.area, 'board');
    const [kr2, kc2] = parseKey(kw.key);
    const [wr2, wc2] = parseKey(ww.key);
    assert.equal(wr2, kr2, 'same row');
    assert.equal(wc2, kc2 - 1, '白面鸮 sits directly behind 空弦 (its 身前 is 空弦)');
    assert.equal(pieceDir(ww.piece), 'RIGHT');
  } finally { m.dispose(); }
});

test('manual: comboLayoutSteps re-orients a follower already standing behind its anchor', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 3 }).start();
  const m = h.m;
  try {
    h.run(() => m.phase === PHASE.PREP);
    const ps = [...m.players.values()].find((p) => p.botPersona === 'amiya_fallback');
    // 白面鸮 already directly behind 空弦 — but facing LEFT. The pair may relocate to a better-value compliant
    // spot (owner 2026-10-07: candidates are scored by the exposure model), so assert the SHAPE plus stability:
    // once correctly seated, a second pass must leave the pair where it is.
    const ps0 = ps.acquireChess('chess_char_4_21_a');
    const ks0 = ps.acquireChess('chess_char_3_21_a');
    assert.ok(ps0 && ks0, 'acquireChess succeeded');
    const findUid = (id) => [...ps.allChess()].find((p) => m.gd.baseIdOf(p.id) === id)?.uid;
    const owUid = findUid('chess_char_4_21_a');
    const ksUid = findUid('chess_char_3_21_a');
    const map = ps.deployMap();
    const owPos = positionClass(m.gd.chess('chess_char_4_21_a'));
    const ksPos = positionClass(m.gd.chess('chess_char_3_21_a'));
    // an anchor tile whose left neighbour can host the follower, both free
    const seat = legalTiles(map, ksPos).find(([r, c]) => legalTiles(map, owPos).some(([r2, c2]) => r2 === r && c2 === c - 1) && !ps.board.has(`${r},${c}`) && !ps.board.has(`${r},${c - 1}`));
    assert.ok(seat, 'a placeable anchor+seat pair exists');
    const [ar, ac] = seat;
    assert.ok(ps.move(ksUid, { area: 'board', row: ar, col: ac }, 'RIGHT').ok, '空弦 placed');
    assert.ok(ps.move(owUid, { area: 'board', row: ar, col: ac - 1 }, 'LEFT').ok, '白面鸮 placed behind it, facing LEFT');
    runSteps(comboLayoutSteps(m, ps));
    const ww = ps.find(owUid);
    const kw = ps.find(ksUid);
    assert.equal(ww.area, 'board');
    assert.equal(kw.area, 'board');
    let [wr2, wc2] = parseKey(ww.key);
    let [kr2, kc2] = parseKey(kw.key);
    assert.equal(wr2, kr2, 'same row');
    assert.equal(wc2, kc2 - 1, '白面鸮 sits directly behind 空弦 (its 身前 is 空弦)');
    assert.equal(pieceDir(ww.piece), 'RIGHT', '白面鸮 faces its anchor');
    // stability: a correctly seated pair is not shuffled around on the next pass
    runSteps(comboLayoutSteps(m, ps));
    const ww2 = ps.find(owUid);
    const kw2 = ps.find(ksUid);
    assert.equal(ww2.key, ww.key, '白面鸮 keeps its seat');
    assert.equal(kw2.key, kw.key, '空弦 keeps its seat');
    assert.equal(pieceDir(ww2.piece), 'RIGHT');
  } finally { m.dispose(); }
});

test('manual: comboLayoutSteps locks the follower to its highest-value anchor', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 3 }).start();
  const m = h.m;
  try {
    h.run(() => m.phase === PHASE.PREP);
    const ps = [...m.players.values()].find((p) => p.botPersona === 'amiya_fallback');
    // 铃兰 follows many anchors: 焰尾 (value 16) must win over 灰毫 (value 10)
    const suz0 = ps.acquireChess('chess_char_5_10_a');
    const ft0 = ps.acquireChess('chess_char_4_19_a');
    const ash0 = ps.acquireChess('chess_char_2_18_a');
    assert.ok(suz0 && ft0 && ash0, 'acquireChess succeeded');
    const findUid = (id) => [...ps.allChess()].find((p) => m.gd.baseIdOf(p.id) === id)?.uid;
    const suzUid = findUid('chess_char_5_10_a');
    const ftUid = findUid('chess_char_4_19_a');
    const ashUid = findUid('chess_char_2_18_a');
    const map = ps.deployMap();
    const suzPos = positionClass(m.gd.chess('chess_char_5_10_a'));
    const ftPos = positionClass(m.gd.chess('chess_char_4_19_a'));
    const ashPos = positionClass(m.gd.chess('chess_char_2_18_a'));
    // 焰尾 on a tile whose left neighbour can host the ranged 铃兰; 灰毫 far away
    const ftSeats = legalTiles(map, ftPos).filter(([r, c]) => legalTiles(map, suzPos).some(([r2, c2]) => r2 === r && c2 === c - 1) && !ps.board.has(`${r},${c}`) && !ps.board.has(`${r},${c - 1}`));
    assert.ok(ftSeats.length, 'a placeable 焰尾+铃兰 pair exists');
    const [ar, ac] = ftSeats[0];
    const ashTiles = legalTiles(map, ashPos).filter(([r, c]) => !ps.board.has(`${r},${c}`) && Math.abs(r - ar) + Math.abs(c - ac) > 2);
    assert.ok(ashTiles.length, 'a distant 灰毫 tile exists');
    assert.ok(ps.move(ftUid, { area: 'board', row: ar, col: ac }, 'RIGHT').ok, '焰尾 placed');
    const [hr, hc] = ashTiles[ashTiles.length - 1];
    assert.ok(ps.move(ashUid, { area: 'board', row: hr, col: hc }, 'RIGHT').ok, '灰毫 placed far away');
    const suzTiles = legalTiles(map, suzPos).filter(([r, c]) => !ps.board.has(`${r},${c}`) && Math.abs(r - ar) + Math.abs(c - ac) > 2 && Math.abs(r - hr) + Math.abs(c - hc) > 2);
    assert.ok(suzTiles.length, 'a distant 铃兰 tile exists');
    const [sr, sc] = suzTiles[0];
    assert.ok(ps.move(suzUid, { area: 'board', row: sr, col: sc }, 'RIGHT').ok, '铃兰 placed far from both');
    runSteps(comboLayoutSteps(m, ps));
    const sw = ps.find(suzUid);
    const fw = ps.find(ftUid);
    assert.equal(sw.area, 'board');
    const [sr2, sc2] = parseKey(sw.key);
    const [fr2, fc2] = parseKey(fw.key);
    assert.equal(sr2, fr2, '铃兰 joins 焰尾\'s row (wherever the pair seats)');
    assert.equal(sc2, fc2 - 1, '铃兰 sits behind 焰尾 (the value-16 anchor), not behind 灰毫 (value 10)');
    assert.equal(pieceDir(sw.piece), 'RIGHT');
  } finally { m.dispose(); }
});

test('manual: stackEaseOf maps last round\'s outcome to the stacking tolerance (叠层×防守动态权重)', () => {
  const no = (ps) => stackEaseOf(ps);
  assert.equal(no(null), 0.5, 'no player: neutral');
  assert.equal(no({}), 0.5, 'no data yet (first round): neutral');
  assert.equal(no({ _lastRoundLeaked: 3, _lastSurvivors: { total: 6, alive: 6 } }), 0, 'leaked: defence first');
  assert.equal(no({ _lastRoundLeaked: 0, _lastSurvivors: { total: 6, alive: 4 } }), 1, 'clean clear, majority alive: stack freely');
  assert.equal(no({ _lastRoundLeaked: 0, _lastSurvivors: { total: 6, alive: 3 } }), 0.5, 'clean clear, half down: neutral');
  assert.equal(no({ _lastRoundLeaked: 0, _lastSurvivors: null }), 0.5, 'no snapshot: neutral');
  assert.equal(no({ _lastRoundLeaked: 0, _lastSurvivors: { total: 0, alive: 0 } }), 0.5, 'empty snapshot: neutral');
});

test('manual: stackTake gates a combo move by the ease tolerance', () => {
  // value-8 combo (塞雷娅+调香师): full tolerance = 1 × 8 × 0.25 = 2 expected kills
  assert.equal(stackTake(1, 8, 10, 9, false), true, 'easy round: a 1-kill cost for stacking is accepted');
  assert.equal(stackTake(1, 8, 6, 9, false), false, 'easy round: a 3-kill cost still exceeds the tolerance');
  assert.equal(stackTake(0, 8, 8.99, 9, false), false, 'struggled round: any value loss refuses to stack');
  assert.equal(stackTake(0, 8, 9, 9, false), true, 'struggled round: a free (non-lowering) combo still applies');
  assert.equal(stackTake(0.5, 8, 8, 9, false), true, 'neutral: cost 1 ≤ tolerance 1');
  // seated pairs move only for a clear gain
  assert.equal(stackTake(1, 8, 10, 9, true), false, 'seated + easy: a 1-kill gain is not worth the shuffle');
  assert.equal(stackTake(1, 8, 12, 9, true), true, 'seated + easy: a 3-kill gain is');
  assert.equal(stackTake(0, 8, 9.01, 9, true), true, 'seated + struggled: any strict gain is');
});

test('manual: comboLayoutSteps seats 塞雷娅+调香师 without giving up the blocking line (兼顾叠层与防守)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: personaSeats(), seed: 3 }).start();
  const m = h.m;
  try {
    h.run(() => m.phase === PHASE.PREP);
    const ps = [...m.players.values()].find((p) => p.botPersona === 'amiya_fallback');
    // the pair starts scattered on off-road corner tiles — the old code dragged 塞雷娅 to wherever 调香师
    // could face her (owner 2026-10-07 screenshot: a blocker parked where no enemy ever passes)
    assert.ok(ps.acquireChess('chess_char_5_11_a') && ps.acquireChess('chess_char_2_14_a'), 'acquireChess succeeded');
    const findUid = (id) => [...ps.allChess()].find((p) => m.gd.baseIdOf(p.id) === id)?.uid;
    const sarUid = findUid('chess_char_5_11_a');
    const perfUid = findUid('chess_char_2_14_a');
    assert.ok(sarUid && perfUid, 'both pieces owned');
    const model = fieldModel(m, ps);
    const map = ps.deployMap();
    const _off = (id, r, c) => { const rec = m.gd.chess(id); const cls = positionClass(rec); if (!legalTiles(map, cls).some(([r2, c2]) => r2 === r && c2 === c) || model.ground.has(`${r},${c}`)) return false; return ps.move(findUid(id), { area: 'board', row: r, col: c }, 'RIGHT').ok; };
    const sarOff = [...legalTiles(map, positionClass(m.gd.chess('chess_char_5_11_a')))].find(([r, c]) => !model.ground.has(`${r},${c}`));
    const perfOff = [...legalTiles(map, positionClass(m.gd.chess('chess_char_2_14_a')))].find(([r, c]) => !model.ground.has(`${r},${c}`) && Math.abs(r - sarOff[0]) + Math.abs(c - sarOff[1]) > 2);
    assert.ok(sarOff && perfOff, 'off-road corner tiles exist');
    assert.ok(ps.move(sarUid, { area: 'board', row: sarOff[0], col: sarOff[1] }, 'RIGHT').ok, '塞雷娅 placed off-road');
    assert.ok(ps.move(perfUid, { area: 'board', row: perfOff[0], col: perfOff[1] }, 'RIGHT').ok, '调香师 placed far away');
    // a compliant placement with the follower ON the road must exist for this assertion to be fair
    const perfPos = positionClass(m.gd.chess('chess_char_2_14_a'));
    const sarPos = positionClass(m.gd.chess('chess_char_5_11_a'));
    const roadPair = legalTiles(map, perfPos).some(([r, c]) => legalTiles(map, sarPos).some(([r2, c2]) => r2 === r && c2 === c - 1 && model.ground.has(`${r},${c - 1}`)));
    assert.ok(roadPair, 'a compliant pair placement with 塞雷娅 on the road exists');
    runSteps(comboLayoutSteps(m, ps));
    const sw = ps.find(sarUid);
    const pw = ps.find(perfUid);
    assert.equal(sw.area, 'board');
    assert.equal(pw.area, 'board');
    const [sr, sc] = parseKey(sw.key);
    const [pr, pc] = parseKey(pw.key);
    assert.equal(sr, pr, 'same row');
    assert.equal(sc, pc - 1, '塞雷娅 sits directly behind 调香师 (its 身前 is 调香师)');
    assert.equal(pieceDir(sw.piece), 'RIGHT');
    assert.ok(model.ground.has(`${sr},${sc}`), '塞雷娅 still stands on the enemy road — blocking, not parking in a corner');
  } finally { m.dispose(); }
});
