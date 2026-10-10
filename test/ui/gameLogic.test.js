// Unit tests for the in-match UI's pure logic (public/js/ui/gameLogic.js): placement mirror (canPlace),
// drop intents, bond sorting / tiers / members, countdown math, draft / 机变 normalisation, fields,
// shortcuts, settings, enemies preview, result normalisation.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  phaseMode, phaseBanner, isCombatPhase, isBossPhase, countdownState, phaseTotalSeconds, sortBonds, bondTier, nextThreshold,
  battleOverSfx, ownRoundLoss, uniteResultBox, battleResultBox, roundResultBox, RESULT_BOX_MS,
  bondMembers, memberHeadCount, bannedPerBond, priceTone, mergeProgress, shopBlockReason, deploySets, indexPieces, placementContext, canPlace,
  boardTargets, dropIntent, normalizeDraft, normalizeSp, normalizePersonalChoice, groupEnemies, factionTypes, snapHud, bossFrac, attackInterval, fmtNum,
  rangeGridBox, shortcutFor, sanitizeSettings, DEFAULT_SETTINGS, normalizeResult, cycleField, fieldLabel, homeFieldId,
  activeBubbles, sortedPlayers, tileKey, prepCapsuleLabel, prepCamera, dropFailureReason, terrainInfo,
} from '../../public/js/ui/gameLogic.js';
import { pairPlayers } from '../../server/match/finalAssault.js';
import { PHASE, GEO } from '../../shared/constants.js';
import { setLang, setMessages } from '../../shared/i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const chess = load('chess.json');
const stages = load('stages.json');
const items = load('items.json');
const tokens = load('tokens.json');
const bonds = load('bonds.json');
const config = load('config.json');
const getChess = (id) => chess[id] || null;
const getItem = (id) => items[id] || null;
const getToken = (id) => tokens[id] || null;

const STAGE = stages.act2autochess_m01;
const MELEE = 'chess_char_1_02_a'; // 角峰
const RANGED = 'chess_char_1_01_a'; // 隐现
const EQUIP = 'chess_item_1_01_e_a';
const MAGIC = 'chess_item_6_01_m';

let uid = 0;
const piece = (id, extra = {}) => ({ uid: ++uid, kind: 'chess', id, golden: false, tier: chess[id]?.tier ?? 1, items: [], ...extra });
const item = (id) => ({ uid: ++uid, kind: 'item', id, golden: false, tier: 1 });

function privWith({ board = [], hand = [], temp = [], deployCap = 8, ready = false, loadout = null } = {}) {
  const h = new Array(GEO.HAND_SIZE).fill(null);
  hand.forEach((p, i) => { if (p) h[p.idx ?? i] = p.piece ?? p; });
  const t = new Array(GEO.TEMP_SIZE).fill(null);
  temp.forEach((p, i) => { t[i] = p; });
  return { alive: true, ready, funds: 10, board, hand: h, temp: t, deployCap, deployCount: board.filter((p) => p.kind === 'chess').length, canReady: !t.some(Boolean),
    loadout, shop: { level: 3, maxLevel: 6, upgradePrice: 8, refreshPrice: 1, freeRefreshes: 0, frozen: false, slots: [] } };
}
const ctxFor = (priv, editable = true) => placementContext({ priv, stage: STAGE, editable, getChess, getItem, getToken });

describe('phases', () => {
  test('phaseMode maps every phase', () => {
    assert.equal(phaseMode(null), 'loading');
    assert.equal(phaseMode(PHASE.INFO_CHECK), 'briefing');
    assert.equal(phaseMode(PHASE.BAND_DRAFT), 'draft');
    assert.equal(phaseMode(PHASE.BATTLE_CHECK), 'boot');
    for (const p of [PHASE.PREP, PHASE.SP_DRAFT, PHASE.ROUND_START]) assert.equal(phaseMode(p), 'prep');
    for (const p of [PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]) assert.equal(phaseMode(p), 'combat');
    assert.equal(phaseMode(PHASE.SETTLE), 'settle');
    assert.equal(phaseMode(PHASE.RESULT), 'result');
    assert.equal(phaseMode('SOMETHING_NEW'), 'prep');
  });
  test('combat / boss predicates and banners', () => {
    assert.ok(isCombatPhase(PHASE.UNITE) && !isCombatPhase(PHASE.PREP));
    assert.ok(isBossPhase(PHASE.HIDDEN_CORE) && !isBossPhase(PHASE.COMBAT));
    assert.equal(phaseBanner(PHASE.UNITE, {}).title, '联防阶段');
    assert.equal(phaseBanner(PHASE.FINAL_ASSAULT, {}).title, '最终攻势');
    assert.equal(phaseBanner(PHASE.HIDDEN_CORE, {}).title, '隐秘核心');
    assert.equal(phaseBanner(PHASE.COMBAT, {}).title, '作战开始');
    assert.match(phaseBanner(PHASE.ROUND_START, { round: 7 }).title, /7/);
    assert.equal(phaseBanner(PHASE.SETTLE, {}), null);
    assert.equal(prepCapsuleLabel(PHASE.PREP), '休息一下');
  });
  test('the round-start banner says 资金已到账 to a player still in only — 观战中 to an eliminated player and a spectator seat (GitHub #236)', () => {
    // round 2 after p_0 ran out of LP: p_1 is still in; the spectator seat s_spec has no row in m.public
    const pub = { round: 2, phase: PHASE.ROUND_START, players: [
      { playerId: 'p_0', seat: 0, alive: false }, { playerId: 'p_1', seat: 1, alive: true },
    ] };
    const round = (viewer) => phaseBanner(PHASE.ROUND_START, pub, viewer);
    // a player still in (the server paid the round's income)
    assert.equal(round({ alive: true, spectator: false }).sub, '资金已到账');
    assert.equal(round().sub, '资金已到账', 'no viewer given: the copy of a player still in');
    // an eliminated player (eliminate() zeroed funds and pendingFunds; startRound pays the seats still in only)
    assert.equal(round({ alive: false, spectator: false }).sub, '观战中');
    // a spectator seat (no seat, no funds), also when only `spectator` is given
    assert.equal(round({ alive: false, spectator: true }).sub, '观战中');
    assert.equal(round({ spectator: true }).sub, '观战中');
    // the title and the other phases' copy are the same for every viewer
    for (const v of [{ alive: true }, { alive: false }, { alive: false, spectator: true }]) {
      assert.equal(round(v).title, '第 2 回合');
      assert.equal(phaseBanner(PHASE.PREP, pub, v).sub, phaseBanner(PHASE.PREP, pub).sub);
    }
    // the match screen hands the banner its viewer (screens/game.js `alive` folds a spectator seat in)
    const src = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
    assert.match(src, /phaseBanner\(phase, pub, \{ alive, spectator \}\)/);
  });
  // GitHub #235 (PR #112 by @Convey123): the official round result dialog and its 战斗结束 sound at SETTLE
  test('战斗结束 sound: the official BATTLEOVER_* variant for the round', () => {
    // 掉血 → _REDUCE；联防里自己没被扣 → _NOREDUCE；普通回合没扣 → _NORMAL；本回合没打过（不在本回合 / 重连落在结算）→ 不响
    // `cost` is what screens/game.js roundLossRef keeps — { round, leaks, cap, unite }; it has no `pending` (a field the
    // object never carried is how the Reduce variant was once dead code, review on PR #112)
    const cost = (o) => ({ round: 3, leaks: 0, cap: 10, unite: false, ...o });
    assert.equal(battleOverSfx(cost({ leaks: 3 })), 'battleOverReduce');
    assert.equal(battleOverSfx(cost({ leaks: 1, unite: true })), 'battleOverReduce');
    assert.equal(battleOverSfx(cost({ unite: true })), 'battleOverNoReduce');
    assert.equal(battleOverSfx(cost({})), 'battleOverNormal');
    // the cap bounds it like settlement's charge (14 leaks with cap 10 is still a loss)
    assert.equal(battleOverSfx(cost({ leaks: 14, cap: 10 })), 'battleOverReduce');
    assert.equal(battleOverSfx(cost({ leaks: 14, cap: undefined })), 'battleOverReduce', 'no cap known → the official 10');
    // a 联防 round: the authority's charge decides, not the own battle's leaks — a leaker whose enemies the helpers
    // stopped paid 0 and hears NoReduce
    assert.equal(battleOverSfx(cost({ leaks: 3, unite: true }), 0), 'battleOverNoReduce');
    assert.equal(battleOverSfx(cost({ leaks: 3, unite: true }), 3), 'battleOverReduce');
    assert.equal(battleOverSfx(cost({ leaks: 0, unite: true }), 2), 'battleOverReduce');
    assert.equal(battleOverSfx(cost({ leaks: 2, unite: true }), null), 'battleOverReduce', 'no 联防 figure → the own battle decides');
    assert.equal(battleOverSfx(cost({ leaks: 2, unite: true }), undefined), 'battleOverReduce');
    // this round's battle never seen (a spectator seat, an eliminated player, a reconnect landing on SETTLE)
    assert.equal(battleOverSfx(null), null);
    assert.equal(battleOverSfx(undefined, 0), null);
  });
  test('ownRoundLoss: min(cap, leaks) — what settlement charges outside a 联防', () => {
    assert.equal(ownRoundLoss({ leaks: 3, cap: 10 }), 3);
    assert.equal(ownRoundLoss({ leaks: 14, cap: 10 }), 10);
    assert.equal(ownRoundLoss({ leaks: 14 }), 10);
    assert.equal(ownRoundLoss({ leaks: 2.9, cap: 10 }), 2);
    assert.equal(ownRoundLoss({ leaks: 0 }), 0);
    assert.equal(ownRoundLoss(null), null);
    assert.equal(ownRoundLoss({ cap: 10 }), null, 'no leaks seen → no figure at all');
  });
  test('round result box: the official words — 作战结束 + 全员无伤！ (mint) / 生命值减少 −N (red)', () => {
    assert.equal(RESULT_BOX_MS, 2800, 'inside SETTLE\'s 3 s (server DELAYS.SETTLE)');
    assert.deepEqual(roundResultBox(0), { title: '作战结束', micro: 'BATTLE OVER', tone: 'mint', sub: '全员无伤！', duration: RESULT_BOX_MS });
    assert.deepEqual(roundResultBox(4), { title: '作战结束', micro: 'BATTLE OVER', tone: 'red', sub: '生命值减少 −4', duration: RESULT_BOX_MS });
    assert.equal(roundResultBox(undefined).sub, '全员无伤！', 'an unknown loss reads as no loss');
    assert.equal(roundResultBox(-2).sub, '全员无伤！');
    assert.equal(roundResultBox(2.7).sub, '生命值减少 −2');
    // through t(): the English pack (public/i18n/en.json — no official EN wording in the data, a plain translation)
    try {
      setMessages('en', JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8')));
      setLang('en');
      assert.deepEqual([roundResultBox(0).title, roundResultBox(0).sub, roundResultBox(3).sub], ['Battle over', 'All unharmed!', 'LP reduced by 3']);
    } finally { setLang('zh'); setMessages('en', {}); }
  });
  test('联防 result box: the viewer\'s own charge from the authority, the official words only when true', () => {
    const res = { through: 3, helpers: ['p_1', 'p_2'], leakers: ['p_0'], losses: { p_0: 3, p_1: 0, p_2: 0 } };
    // the leaker reads the LP settlement actually charged — word for word an ordinary round's box
    assert.deepEqual(uniteResultBox(res, 'p_0'), roundResultBox(3));
    assert.equal(uniteResultBox(res, 'p_0').sub, '生命值减少 −3');
    // a helper was spared, but the 联防 leaked and a teammate paid: 全员无伤！ would claim that teammate was unharmed, and
    // the official dialog has no other line (the remake's 「联防失败：还有 N 只突破防线」 was dropped in the owner's review
    // of PR #112) — the official title alone, orange (player report 2026-10-06 on PR #112)
    const helper = uniteResultBox(res, 'p_1');
    assert.equal(helper.title, '作战结束');
    assert.equal(helper.tone, 'orange');
    assert.equal(helper.sub, '', 'no 全员无伤！ while a teammate was charged');
    assert.ok(!/联防成功|联防失败|突破防线/.test(JSON.stringify(helper)), 'no 联防 verdict line');
    // nothing got through: nobody paid, so 全员无伤！ is true for leaker and helper alike — the only 联防 case that says it
    const cleared = { through: 0, helpers: ['p_1', 'p_2'], leakers: ['p_0'], losses: { p_0: 0, p_1: 0, p_2: 0 } };
    assert.deepEqual(uniteResultBox(cleared, 'p_0'), roundResultBox(0));
    assert.deepEqual(uniteResultBox(cleared, 'p_1'), roundResultBox(0));
    // two leakers, one spared by the 联防, one charged: only the charged one reads 生命值减少
    const spared = { through: 3, helpers: ['p_1'], leakers: ['p_0', 'p_2'], losses: { p_0: 0, p_2: 2, p_1: 0 } };
    assert.equal(uniteResultBox(spared, 'p_0').sub, '', 'spared leaker, but the 联防 leaked: no claim');
    assert.equal(uniteResultBox(spared, 'p_2').sub, '生命值减少 −2');
    assert.equal(uniteResultBox(spared, 'p_1').sub, '', 'the helper, whose teammate paid');
    // not in the round — a spectator seat, a player eliminated before it (settle lists alive players only): no box,
    // as in a round without 联防 where a viewer without a battle gets none (and no sound) [ASSUMED]
    assert.equal(uniteResultBox(res, 'nobody'), null);
    assert.equal(uniteResultBox(cleared, 'nobody'), null);
    assert.equal(uniteResultBox(res, undefined), null);
    assert.equal(uniteResultBox(res, null), null);
    // no 联防 this round: no box from here (the own battle's takes over)
    assert.equal(uniteResultBox(null, 'p_0'), null);
    assert.equal(uniteResultBox(undefined, 'p_0'), null);
    assert.equal(uniteResultBox({}, 'p_0'), null);
    assert.equal(uniteResultBox({ through: -1 }, 'p_0'), null);
    // a view without `losses` makes no LP claim — and never falls back to the own battle's leaks, which a 联防 removed
    const noLosses = uniteResultBox({ through: 3, helpers: ['p_1'], leakers: ['p_0'] }, 'p_0');
    assert.equal(noLosses.title, '作战结束');
    assert.equal(noLosses.sub, '', 'no LP known → no LP claim');
    assert.equal(noLosses.tone, 'orange', 'no LP known → not read as a loss');
    assert.equal(uniteResultBox({ through: 0, helpers: ['p_1'], leakers: ['p_0'] }, 'p_1').sub, '');
  });
  test('作战 result box (no 联防): 全员无伤！ without a leak, min(cap, leaks) otherwise, nothing without a battle', () => {
    assert.deepEqual(battleResultBox({ leaks: 0, cap: 10 }), roundResultBox(0));
    const bad = battleResultBox({ leaks: 3, cap: 10 });
    assert.equal(bad.title, '作战结束');
    assert.equal(bad.tone, 'red');
    assert.equal(bad.sub, '生命值减少 −3');
    // the per-round LP cap (config.lpCapPerRound): the loss shown is min(cap, leaks), never the leaked count
    assert.equal(battleResultBox({ leaks: 14, cap: 10 }).sub, '生命值减少 −10');
    assert.equal(battleResultBox({ leaks: 14 }).sub, '生命值减少 −10', 'no cap known → the official 10');
    assert.equal(battleResultBox({ leaks: 2, cap: 5 }).sub, '生命值减少 −2');
    assert.equal(battleResultBox(null), null);
    assert.equal(battleResultBox({}), null, 'no battle seen this round (a spectator, a reconnect) → no box');
  });
});

describe('countdown', () => {
  test('untimed phases show "--"', () => {
    assert.deepEqual(countdownState(0, Date.now()), { remain: null, warn: false, bars: 0, text: '--', frac: 0 });
    assert.equal(countdownState(null, 1000).text, '--');
    assert.equal(countdownState(NaN, 1000).remain, null);
  });
  test('ceil seconds, warn at ≤10, gauge bars from total', () => {
    const now = 1_000_000;
    const a = countdownState(now + 60_000, now, 60);
    assert.equal(a.remain, 60); assert.equal(a.bars, 5); assert.equal(a.warn, false); assert.equal(a.text, '60');
    const b = countdownState(now + 9_001, now, 60);
    assert.equal(b.remain, 10); assert.equal(b.warn, true); assert.equal(b.bars, 1); assert.equal(b.text, '10');
    const c = countdownState(now + 4_200, now, 60);
    assert.equal(c.text, '05');
    const d = countdownState(now - 5000, now, 60);
    assert.equal(d.remain, 0); assert.equal(d.bars, 0);
    assert.equal(countdownState(now + 30_000, now).bars, 5, 'no total ⇒ full gauge');
    assert.equal(countdownState(now + 2_000_000, now).text, '999', 'clamped to 3 digits');
  });
  test('phase totals from config', () => {
    assert.equal(phaseTotalSeconds({ phase: PHASE.INFO_CHECK }, config), config.timers.infoCheck);
    assert.equal(phaseTotalSeconds({ phase: PHASE.PREP, modeId: 'mode_multi_hard', round: 4 }, config), config.modes.mode_multi_hard.rounds['4'].prepTime);
    assert.equal(phaseTotalSeconds({ phase: PHASE.PREP, modeId: 'mode_single_hard', round: 4 }, config), null, 'solo prep untimed');
    assert.equal(phaseTotalSeconds({ phase: PHASE.SP_DRAFT, sp: { cards: [], picks: {} }, players: [] }, config), config.timers.spFirst);
    assert.equal(phaseTotalSeconds({ phase: PHASE.SP_DRAFT, sp: { cards: [{}, {}], picks: { a: 0 } }, players: [{ playerId: 'a' }] }, config), config.timers.spTurn);
    assert.equal(phaseTotalSeconds(null, config), null);
    // the strategy draft: one countdown, the turn's (m.public.draft.turnSeconds; user playtest #4 item 4)
    assert.equal(phaseTotalSeconds({ phase: PHASE.BAND_DRAFT, draft: { turnSeconds: 30 } }, config), 30);
    assert.equal(phaseTotalSeconds({ phase: PHASE.BAND_DRAFT }, config), config.timers.bandTurn);
  });
});

describe('bonds', () => {
  test('sortBonds: active, layers, count, tier, core, id', () => {
    const list = [
      { bondId: 'deputShip', active: false, layers: 50, count: 1, tier: 0 },
      { bondId: 'preciShip', active: true, layers: 3, count: 2, tier: 1 },
      { bondId: 'yanShip', active: true, layers: 3, count: 2, tier: 1 },
      { bondId: 'swiftShip', active: true, layers: 9, count: 2, tier: 1 },
      null, { nope: 1 },
    ];
    const sorted = sortBonds(list, (id) => bonds[id]).map((b) => b.bondId);
    assert.deepEqual(sorted, ['swiftShip', 'yanShip', 'preciShip', 'deputShip']);
    assert.deepEqual(sortBonds(undefined), []);
  });
  test('bondTier / nextThreshold incl. downward bonds', () => {
    assert.equal(bondTier(5, [3, 6, 9]), 1);
    assert.equal(bondTier(9, [3, 6, 9]), 3);
    assert.equal(bondTier(0, [2]), 0);
    assert.equal(bondTier(1, [1], 1), 1);
    assert.equal(bondTier(2, [1], 1), 0, '独行 inactive above maxCount');
    assert.equal(nextThreshold(4, [3, 6, 9]), 6);
    assert.equal(nextThreshold(9, [3, 6, 9]), null);
  });
  test('bondMembers marks on-board / owned / banned', () => {
    const b = bonds.deputShip;
    const [m1, m2, m3] = b.visibleMembers;
    const priv = privWith({ board: [{ ...piece(m1), row: 9, col: 3 }], hand: [piece(chess[m2].goldenId)] });
    const rows = bondMembers(b, priv, [m3], getChess);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get(m1).onBoard, true);
    assert.equal(byId.get(m2).owned, true, 'golden in hand counts as owned base');
    assert.equal(byId.get(m2).onBoard, false);
    assert.equal(byId.get(m3).banned, true);
    assert.equal(byId.get(m2).inHand, true, 'a golden copy in the hand marks the base in hand');
    assert.equal(rows[0].id, m1, 'on-board first');
    assert.equal(rows.length, b.visibleMembers.length);
  });
  test('memberHeadCount: the hand counts only for a bond that counts the hand, once per row', () => {
    const rows = [
      { id: 'a', onBoard: true, inHand: true },
      { id: 'b', onBoard: false, inHand: true },
      { id: 'c', onBoard: false, inHand: false },
      null,
    ];
    assert.equal(memberHeadCount(rows, false), 1, 'board only');
    assert.equal(memberHeadCount(rows, true), 2, 'board or hand, one row once');
    assert.equal(memberHeadCount(null, true), 0);
    assert.equal(memberHeadCount(undefined), 0);
    const invest = bonds.investShip;
    assert.equal(invest.countsHand, true);
    const [m1, m2] = invest.visibleMembers;
    const priv = privWith({
      board: [{ ...piece(m1), row: 9, col: 3 }],
      hand: [piece(m2)],
      temp: [piece(invest.visibleMembers[2] || m2)],
    });
    const got = bondMembers(invest, priv, [], getChess);
    const byId = new Map(got.map((r) => [r.id, r]));
    assert.equal(byId.get(m1).onBoard, true);
    assert.equal(byId.get(m2).inHand, true);
    assert.equal(byId.get(m2).onBoard, false);
    if (invest.visibleMembers[2]) assert.equal(byId.get(invest.visibleMembers[2]).inHand, false, 'a temporary-slot copy is not in hand');
    assert.equal(memberHeadCount(got, true), 2, 'the board member and the hand member, not the temporary slot');
    assert.equal(memberHeadCount(got, false), 1, 'without countsHand the hand member is left out');
  });
  test('sortBonds puts a mode-off bond after every live bond', () => {
    const sorted = sortBonds([
      { bondId: 'investShip', off: true, active: false, layers: 99, count: 3, tier: 0 },
      { bondId: 'yanShip', active: true, layers: 1, count: 3, tier: 1 },
      { bondId: 'raidShip', off: true, layers: 0, count: 1 },
    ], (id) => bonds[id]).map((b) => b.bondId);
    assert.deepEqual(sorted, ['yanShip', 'investShip', 'raidShip']);
  });
  test('bannedPerBond counts banned visible members', () => {
    const b = bonds.deputShip;
    const per = bannedPerBond(Object.values(bonds), [b.visibleMembers[0], b.visibleMembers[1], 'nope']);
    assert.equal(per.get('deputShip'), 2);
    assert.equal(per.get('yanShip') >= 0, true);
  });
});

describe('shop', () => {
  test('priceTone: discount / markup / normal / free', () => {
    assert.equal(priceTone({ price: 2, basePrice: 3 }), 'discount');
    assert.equal(priceTone({ price: 4, basePrice: 3 }), 'premium');
    assert.equal(priceTone({ price: 3, basePrice: 3 }), 'gold');
    assert.equal(priceTone({ price: 0, basePrice: 3 }), 'discount');
    assert.equal(priceTone({ price: 3 }), 'gold');
    assert.equal(priceTone(null), 'gold');
  });
  test('mergeProgress counts normal copies on board, hand and temp', () => {
    const priv = privWith({ board: [{ ...piece(MELEE), row: 9, col: 3 }], hand: [piece(MELEE), piece(chess[MELEE].goldenId, { golden: true })], temp: [piece(MELEE)] });
    assert.deepEqual(mergeProgress(priv, MELEE, getChess), { copies: 3, need: 3 });
    assert.deepEqual(mergeProgress(privWith(), 'chess_char_2_11_a', getChess).need, chess.chess_char_2_11_a.upgradeNum);
  });
  test('shopBlockReason', () => {
    const priv = privWith();
    assert.equal(shopBlockReason('buy', { priv, editable: true, slot: { price: 3, sold: false } }), null);
    assert.equal(shopBlockReason('buy', { priv, editable: true, slot: { price: 30 } }), '资金不足');
    assert.equal(shopBlockReason('buy', { priv, editable: true, slot: { price: 1, sold: true } }), '已售出');
    assert.equal(shopBlockReason('buy', { priv: { ...priv, ready: true }, editable: false, slot: {} }), '已准备就绪，取消准备后才能操作');
    assert.equal(shopBlockReason('levelUp', { priv: { ...priv, shop: { ...priv.shop, level: 6 } }, editable: true }), '调度中心已达最高等级');
    assert.equal(shopBlockReason('refresh', { priv: { ...priv, funds: 0 }, editable: true }), '资金不足');
    assert.equal(shopBlockReason('refresh', { priv: { ...priv, funds: 0, shop: { ...priv.shop, refreshPrice: 0 } }, editable: true }), null, 'free refresh');
    assert.match(shopBlockReason('ready', { priv: { ...priv, canReady: false } }), /临时整备区/);
    assert.equal(shopBlockReason('ready', { priv }), null);
    assert.equal(shopBlockReason('buy', { priv: { ...priv, alive: false }, editable: true }), '你已被淘汰');
    assert.equal(shopBlockReason('buy', {}), '尚未就绪');
  });
});

describe('placement mirror (canPlace)', () => {
  test('deploySets uses stage deployTiles, derived legend as fallback', () => {
    const d = deploySets(STAGE);
    assert.ok(d.melee.has('9,3') && d.ranged.has('9,3'));
    assert.ok(!d.melee.has('10,4') && d.ranged.has('10,4'), 'high ground: ranged only');
    assert.ok(!d.ranged.has('9,2'), 'objective not deployable');
    const { deployTiles, ...noDt } = STAGE; // eslint-disable-line no-unused-vars
    const d2 = deploySets(noDt);
    assert.deepEqual([...d2.melee].sort(), [...d.melee].sort());
    assert.deepEqual([...d2.ranged].sort(), [...d.ranged].sort());
    assert.equal(deploySets(null).melee.size, 0);
  });
  test('melee vs ranged tiles', () => {
    const m = piece(MELEE);
    const r = piece(RANGED);
    const ctx = ctxFor(privWith({ hand: [m, r] }));
    assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 9, col: 3 }).ok, true);
    assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 10, col: 4 }).ok, false, 'melee on high ground');
    assert.equal(canPlace(ctx, r.uid, { area: 'board', row: 10, col: 4 }).ok, true);
    assert.equal(canPlace(ctx, r.uid, { area: 'board', row: 9, col: 3 }).ok, true, 'ranged may use melee tiles');
    assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 9, col: 2 }).ok, false, 'objective');
    assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 9, col: 10 }).ok, false, 'gate');
    assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 9, col: 12 }).ok, false, 'outside own field');
    assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 7, col: 3 }).ok, false, 'hand row is not board');
    assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 9.5, col: 3 }).ok, false, 'non-integer');
    assert.equal(canPlace(ctx, 99999, { area: 'board', row: 9, col: 3 }).ok, false, 'unknown uid');
    assert.equal(canPlace(ctx, m.uid, null).ok, false);
    assert.equal(canPlace(ctx, m.uid, { area: 'temp', idx: 0 }).ok, false, 'no temp target');
  });
  test('every trait holder (歌蕾蒂娅, 崖心, 见行者, normal and elite) lights the 高台 whatever the module; a plain melee stays on the ground', () => {
    const holders = ['chess_char_4_12_a', 'chess_char_4_12_b', 'chess_char_2_03_a', 'chess_char_2_03_b', 'chess_char_3_07_a', 'chess_char_3_07_b'].map((id) => piece(id));
    const m = piece(MELEE);
    const every = STAGE.deployTiles.normal.melee.length + STAGE.deployTiles.normal.rangedOnly.length;
    // the module does not matter: the default, HOK-Y, HOK-X and none on 歌蕾蒂娅; 崖心's HOK-X; none on 见行者
    for (const loadout of [null, { chess_char_4_12_a: { module: 'uniequip_003_glady' } }, { chess_char_4_12_a: { module: 'uniequip_002_glady' } },
      { chess_char_4_12_a: { module: 'none' }, chess_char_2_03_a: { module: 'none' }, chess_char_3_07_a: { module: 'none' } }]) {
      const ctx = ctxFor(privWith({ hand: [...holders, m], loadout }));
      for (const p of holders) {
        for (const [row, col] of [[10, 4], [11, 4], [12, 4], [9, 3]]) assert.equal(canPlace(ctx, p.uid, { area: 'board', row, col }).ok, true, `${p.id} on ${row},${col} (${JSON.stringify(loadout)})`);
        assert.equal(boardTargets(ctx, p.uid).legal.length, every, `${p.id}: every deploy tile lit`);
      }
      assert.deepEqual(canPlace(ctx, m.uid, { area: 'board', row: 10, col: 4 }), { ok: false, code: 'BAD_TILE', reason: '近战单位只能部署在地面' }, '角峰');
      assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 9, col: 3 }).ok, true, '角峰 on the ground');
    }
  });
  test('not editable ⇒ nothing is legal', () => {
    const m = piece(MELEE);
    assert.equal(canPlace(ctxFor(privWith({ hand: [m] }), false), m.uid, { area: 'board', row: 9, col: 3 }).code, 'WRONG_PHASE');
    assert.equal(canPlace(null, m.uid, { area: 'board', row: 9, col: 3 }).ok, false);
  });
  test('deploy cap counts chess on board only; swap keeps count', () => {
    const board = [];
    const tiles = [[9, 3], [9, 4], [9, 5], [9, 7], [9, 8], [9, 9], [10, 5], [10, 7]];
    for (const [row, col] of tiles) board.push({ ...piece(MELEE), row, col });
    // the 狼群's owner: 伺夜 facing UP on (9,4) — her range (rows 9–12 × cols 3–5) covers the tiles tried below
    // ("只能部署在召唤者攻击范围内", player report #9 after 0.1.0)
    board[1] = { ...piece('chess_char_3_19_a'), row: 9, col: 4, dir: 'UP' };
    const extra = piece(MELEE);
    const ctx = ctxFor(privWith({ board, hand: [extra] }));
    const full = canPlace(ctx, extra.uid, { area: 'board', row: 11, col: 5 });
    assert.equal(full.ok, false); assert.equal(full.code, 'BOARD_FULL');
    assert.deepEqual(canPlace(ctx, extra.uid, { area: 'board', row: 9, col: 3 }), { ok: true, action: 'swap' }, 'swap with a deployed unit');
    const onBoard = board[0];
    assert.equal(canPlace(ctx, onBoard.uid, { area: 'board', row: 11, col: 5 }).ok, true, 'moving on the board never hits the cap');
    // tokens don't use deploy slots
    const tok = { uid: ++uid, kind: 'token', id: 'token_10028_vigil_wolf', count: 1, ownerUid: board[1].uid };
    const ctx2 = ctxFor(privWith({ board, hand: [tok] }));
    assert.equal(canPlace(ctx2, tok.uid, { area: 'board', row: 11, col: 5 }).ok, true);
    assert.equal(canPlace(ctx2, tok.uid, { area: 'board', row: 10, col: 4 }).ok, false, 'MELEE token not on high ground');
    assert.equal(canPlace(ctx2, tok.uid, { area: 'board', row: 9, col: 3 }).code, 'BAD_TILE', 'a hand token never swaps into an occupied tile');
    const orphan = { uid: ++uid, kind: 'token', id: 'token_10028_vigil_wolf', count: 1, ownerUid: 777777 };
    const ctx3 = ctxFor(privWith({ board, hand: [orphan] }));
    assert.equal(canPlace(ctx3, orphan.uid, { area: 'board', row: 11, col: 5 }).code, 'BAD_TARGET', 'summoner must be deployed');
    // a hand chess swapping with a board token takes a deploy slot (cap applies)
    const bTok = { uid: ++uid, kind: 'token', id: 'token_10028_vigil_wolf', count: 1, ownerUid: board[1].uid, row: 11, col: 5 };
    const ctx4 = ctxFor(privWith({ board: [...board, bTok], hand: [extra] }));
    assert.equal(canPlace(ctx4, extra.uid, { area: 'board', row: 11, col: 5 }).code, 'BOARD_FULL');
  });
  test('board→board swap requires both positions to be legal', () => {
    const m = { ...piece(MELEE), row: 9, col: 3 };
    const r = { ...piece(RANGED), row: 10, col: 4 };
    const ctx = ctxFor(privWith({ board: [m, r] }));
    assert.equal(canPlace(ctx, r.uid, { area: 'board', row: 9, col: 3 }).ok, false, 'the melee unit cannot go to the high tile');
    assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 10, col: 4 }).ok, false);
    // its own tile: legal — the direction wheel re-orients it in place (research 09 §1.2)
    assert.deepEqual(canPlace(ctx, m.uid, { area: 'board', row: 9, col: 3 }), { ok: true, action: 'orient' });
    assert.deepEqual(dropIntent(ctx, m.uid, { area: 'board', row: 9, col: 3 }), { t: 'g.move', fields: { uid: m.uid, to: { area: 'board', row: 9, col: 3 } } });
  });
  test('hand targets: move, swap, same slot, board unit vs hand item', () => {
    const b = { ...piece(RANGED), row: 10, col: 4 };
    const h0 = piece(MELEE);
    const it = item(EQUIP);
    const ctx = ctxFor(privWith({ board: [b], hand: [{ idx: 0, piece: h0 }, { idx: 1, piece: it }] }));
    assert.deepEqual(canPlace(ctx, b.uid, { area: 'hand', idx: 5 }), { ok: true, action: 'move' });
    assert.equal(canPlace(ctx, b.uid, { area: 'hand', idx: 0 }).ok, false, 'melee hand unit cannot take the high tile');
    assert.deepEqual(canPlace(ctx, b.uid, { area: 'hand', idx: 1 }), { ok: true, action: 'move' }, 'withdrawn onto an item slot: the server uses another free slot');
    assert.deepEqual(canPlace(ctx, h0.uid, { area: 'hand', idx: 1 }), { ok: true, action: 'swap' }, 'hand ↔ hand swap with an item');
    assert.equal(canPlace(ctx, h0.uid, { area: 'hand', idx: 0 }).code, 'ALREADY');
    assert.equal(canPlace(ctx, h0.uid, { area: 'hand', idx: 10 }).ok, false);
    assert.equal(canPlace(ctx, h0.uid, { area: 'hand', idx: -1 }).ok, false);
  });
  test('summoner withdrawal: a full hand accepts a drop onto its own summon stack', () => {
    const b = { ...piece('chess_char_2_02_a'), row: 10, col: 4 };
    const stack = { uid: ++uid, kind: 'token', id: 'token_10000_silent_healrb', ownerUid: b.uid, count: 1 };
    const ctx = ctxFor(privWith({ board: [b], hand: [...Array.from({ length: 9 }, () => item(EQUIP)), stack] }));
    const to = { area: 'hand', idx: 9 };
    assert.deepEqual(canPlace(ctx, b.uid, to), { ok: true, action: 'move' });
    assert.deepEqual(dropIntent(ctx, b.uid, to), { t: 'g.move', fields: { uid: b.uid, to } });
    assert.equal(dropFailureReason(ctx, b.uid, to), null);
  });
  test('summoner withdrawal: its own stack frees space when dropped onto another item or token', () => {
    const b = { ...piece('chess_char_2_02_a'), row: 10, col: 4 };
    const stack = { uid: ++uid, kind: 'token', id: 'token_10000_silent_healrb', ownerUid: b.uid, count: 1 };
    const other = { ...stack, uid: ++uid, ownerUid: ++uid };
    const ctx = ctxFor(privWith({ board: [b], hand: [...Array.from({ length: 8 }, () => item(EQUIP)), other, stack] }));
    for (const idx of [0, 8]) {
      const to = { area: 'hand', idx };
      assert.deepEqual(canPlace(ctx, b.uid, to), { ok: true, action: 'move' });
      assert.deepEqual(dropIntent(ctx, b.uid, to), { t: 'g.move', fields: { uid: b.uid, to } });
      assert.equal(dropFailureReason(ctx, b.uid, to), null);
    }
  });
  test('summoner withdrawal: a full hand without its own hand stack still refuses the move', () => {
    const b = { ...piece('chess_char_2_02_a'), row: 10, col: 4 };
    const stack = { uid: ++uid, kind: 'token', id: 'token_10000_silent_healrb', ownerUid: b.uid, count: 1 };
    const other = { ...stack, uid: ++uid, ownerUid: ++uid };
    const hand = Array.from({ length: 10 }, () => item(EQUIP));
    const cases = [
      privWith({ board: [b], hand }),
      privWith({ board: [{ ...b, id: MELEE }], hand }),
      privWith({ board: [b], hand: [...hand.slice(0, 9), other] }),
      privWith({ board: [b], hand, temp: [stack] }),
      privWith({ board: [b, { ...stack, row: 9, col: 3 }], hand }),
      privWith({ board: [b], hand: [...hand.slice(0, 9), { ...item(EQUIP), ownerUid: b.uid }] }),
    ];
    for (const priv of cases) {
      const ctx = ctxFor(priv);
      for (const idx of [0, 9]) {
        const to = { area: 'hand', idx };
        assert.equal(canPlace(ctx, b.uid, to).code, 'HAND_FULL');
        assert.equal(dropIntent(ctx, b.uid, to), null);
        assert.equal(dropFailureReason(ctx, b.uid, to), '整备区已满');
      }
    }
  });
  test('summoner withdrawal: freed space does not bypass an illegal chess swap', () => {
    const b = { ...piece('chess_char_2_02_a'), row: 10, col: 4 };
    const stack = { uid: ++uid, kind: 'token', id: 'token_10000_silent_healrb', ownerUid: b.uid, count: 1 };
    const ctx = ctxFor(privWith({ board: [b], hand: [piece(MELEE), ...Array.from({ length: 8 }, () => item(EQUIP)), stack] }));
    const to = { area: 'hand', idx: 0 };
    assert.equal(canPlace(ctx, b.uid, to).code, 'BAD_TILE');
    assert.equal(dropIntent(ctx, b.uid, to), null);
  });
  test('items: equip on chess (board or hand), arts on tiles, not on tokens', () => {
    const b = { ...piece(MELEE), row: 9, col: 3 };
    const hChess = piece(RANGED);
    const tok = { uid: ++uid, kind: 'token', id: 'token_10028_vigil_wolf', count: 1, row: 9, col: 4 };
    const eq = item(EQUIP);
    const art = item(MAGIC);
    const ctx = ctxFor(privWith({ board: [b, tok], hand: [{ idx: 0, piece: hChess }, { idx: 1, piece: eq }, { idx: 2, piece: art }] }));
    assert.deepEqual(canPlace(ctx, eq.uid, { area: 'board', row: 9, col: 3 }), { ok: true, action: 'equip' });
    assert.deepEqual(canPlace(ctx, eq.uid, { area: 'hand', idx: 0 }), { ok: true, action: 'equip' });
    assert.equal(canPlace(ctx, eq.uid, { area: 'board', row: 9, col: 4 }).ok, false, 'tokens cannot carry items');
    assert.equal(canPlace(ctx, eq.uid, { area: 'board', row: 9, col: 5 }).ok, false, 'empty tile');
    assert.deepEqual(canPlace(ctx, eq.uid, { area: 'hand', idx: 7 }), { ok: true, action: 'move' }, 'rearranging the hand');
    assert.deepEqual(canPlace(ctx, art.uid, { area: 'board', row: 11, col: 6 }), { ok: true, action: 'art' });
    assert.equal(canPlace(ctx, art.uid, { area: 'hand', idx: 0 }).ok, false, 'arts are not equipped');
    assert.deepEqual(canPlace(ctx, art.uid, { area: 'hand', idx: 1 }), { ok: true, action: 'swap' }, 'item ↔ item swap in the hand');
  });
  test('boardTargets lists legal tiles for highlighting', () => {
    const m = piece(MELEE);
    const r = piece(RANGED);
    const ctx = ctxFor(privWith({ hand: [m, r] }));
    const lm = boardTargets(ctx, m.uid).legal.map(([a, b]) => tileKey(a, b));
    const lr = boardTargets(ctx, r.uid).legal.map(([a, b]) => tileKey(a, b));
    assert.equal(lm.length, STAGE.deployTiles.normal.melee.length);
    assert.equal(lr.length, STAGE.deployTiles.normal.melee.length + STAGE.deployTiles.normal.rangedOnly.length);
    assert.ok(!lm.includes('10,4') && lr.includes('10,4'));
    assert.deepEqual(boardTargets(ctx, 424242), { legal: [], illegal: [] });
  });
  test('dropIntent builds protocol-valid g.* messages', async () => {
    const { validateC2S } = await import('../../shared/protocol.js');
    // two OTHER items equipped (an identical copy would merge with the incoming one instead: no replacement — see
    // test/ui/leftovers.test.js)
    const b = { ...piece(MELEE), row: 9, col: 3, items: [{ uid: 900, id: 'chess_item_1_02_e_a' }, { uid: 901, id: 'chess_item_1_05_e_a' }] };
    const h = piece(RANGED);
    const eq = item(EQUIP);
    const art = item(MAGIC);
    const ctx = ctxFor(privWith({ board: [b], hand: [{ idx: 0, piece: h }, { idx: 1, piece: eq }, { idx: 2, piece: art }] }));
    const mv = dropIntent(ctx, h.uid, { area: 'board', row: 10, col: 4 });
    assert.deepEqual(mv, { t: 'g.move', fields: { uid: h.uid, to: { area: 'board', row: 10, col: 4 } } });
    const back = dropIntent(ctx, b.uid, { area: 'hand', idx: 6 });
    assert.deepEqual(back.fields.to, { area: 'hand', idx: 6 });
    const eqI = dropIntent(ctx, eq.uid, { area: 'board', row: 9, col: 3 });
    assert.equal(eqI.t, 'g.equip'); assert.equal(eqI.confirmReplace, true, '2 items equipped ⇒ confirm');
    const eqH = dropIntent(ctx, eq.uid, { area: 'hand', idx: 0 });
    assert.equal(eqH.confirmReplace, false);
    const consumable = Object.values(items).find((x) => x.itemType === 'EQUIP' && String(x.kind).startsWith('consume_on_equip'));
    const cons = item(consumable.id);
    const ctxC = ctxFor(privWith({ board: [b], hand: [{ idx: 3, piece: cons }] }));
    // consumed on equip: a full carrier still replaces first (GitHub #263, test/ui/leftovers.test.js)
    assert.equal(dropIntent(ctxC, cons.uid, { area: 'board', row: 9, col: 3 }).confirmReplace, true, 'consumed on equip: still replaces on a full carrier');
    const ar = dropIntent(ctx, art.uid, { area: 'board', row: 12, col: 6 });
    assert.deepEqual(ar, { t: 'g.art', fields: { itemUid: art.uid, row: 12, col: 6 } });
    for (const i of [mv, back, eqI, eqH, ar]) assert.equal(validateC2S({ t: i.t, ...i.fields }), null, i.t);
    assert.equal(dropIntent(ctx, h.uid, { area: 'board', row: 9, col: 2 }), null);
    assert.equal(dropIntent(ctx, h.uid, { area: 'outside', clientX: 1, clientY: 1 }), null);
  });
  test('indexPieces tolerates junk', () => {
    const m = indexPieces({ board: [null, { uid: 'x' }, { uid: 5, row: 9, col: 3, kind: 'chess' }], hand: 'nope', temp: [undefined] });
    assert.equal(m.size, 1);
    assert.equal(indexPieces(null).size, 0);
  });
});

describe('drafts', () => {
  const players = [{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }, { playerId: 'c', seat: 2 }];
  test('normalizeDraft: index or id turn, object or array picks', () => {
    const d1 = normalizeDraft({ order: ['c', 'a', 'b'], turn: 1, picks: { c: 'band_x' } }, players);
    assert.equal(d1.turnPid, 'a'); assert.equal(d1.picks.get('c'), 'band_x'); assert.equal(d1.done, false);
    const d2 = normalizeDraft({ order: ['c', 'a'], turn: 'c', picks: ['band_y', null] }, players);
    assert.equal(d2.turnPid, 'c'); assert.equal(d2.picks.get('c'), 'band_y'); assert.equal(d2.picks.has('a'), false);
    const d3 = normalizeDraft({ picks: [{ playerId: 'a', bandId: 'z' }], skipsLeft: { a: 0 } }, players);
    assert.deepEqual(d3.order, ['a', 'b', 'c']); assert.equal(d3.picks.get('a'), 'z'); assert.equal(d3.skipsLeft.get('a'), 0);
    const d4 = normalizeDraft(null, []);
    assert.equal(d4.turnPid, null); assert.equal(d4.done, false);
    assert.equal(normalizeDraft({ order: ['a'], turn: 5 }).turnPid, null, 'out-of-range index');
    assert.equal(normalizeDraft({ order: ['a'], picks: { a: 'q' } }).done, true);
  });
  test('normalizeSp: picks map, array, takenBy; turn', () => {
    const sp = normalizeSp({ family: 'bounty', cards: ['e1', { effectId: 'e2' }, { itemId: 'i3', takenBy: 'c' }, 7], turn: 'a', picks: { b: 0 } }, players);
    assert.equal(sp.cards.length, 4);
    assert.equal(sp.cards[0].id, 'e1');
    assert.equal(sp.cards[0].takenBy, 'b');
    assert.equal(sp.cards[2].takenBy, 'c');
    assert.equal(sp.pickOf.get('c'), 2);
    assert.equal(sp.turnPid, 'a');
    assert.equal(sp.pickedCount, 2);
    const sp2 = normalizeSp({ cards: [{}, {}], order: ['b', 'a'], turn: 0, picks: [{ playerId: 'b', idx: 1 }, { playerId: 'x', idx: 9 }] }, players);
    assert.equal(sp2.turnPid, 'b'); assert.equal(sp2.cards[1].takenBy, 'b'); assert.equal(sp2.pickOf.has('x'), false);
    assert.equal(normalizeSp(null), null);
    assert.equal(normalizeSp({ cards: new Array(9).fill({}) }).cards.length, 6, 'at most 6 cards');
  });
  test('personal choice: only the living recipient in the current PREP, independent of the public draft', () => {
    const pub = { phase: PHASE.PREP, round: 14, sp: { family: 'supply', cards: ['global'] } };
    const priv = { playerId: 'a', alive: true, canReady: false, temp: [], personalChoice: {
      id: 'seed.choice.3', round: 14, sourceItemId: 'chess_item_6_03_m',
      cards: [{ id: 'e1', kind: 'bounty', name: '战术特训', coin: 2 }, { id: 'e2', kind: 'bounty' }],
    } };
    const before = JSON.stringify({ pub, priv });
    const sp = normalizePersonalChoice(pub, priv, 'a');
    assert.equal(sp.id, priv.personalChoice.id);
    assert.equal(sp.family, 'bounty');
    assert.equal(sp.name, '教鞭 · 战术特训');
    assert.equal(sp.turnPid, 'a');
    assert.equal(sp.pickOf.size, 0);
    assert.deepEqual(sp.cards.map((c) => c.idx), [0, 1]);
    assert.ok(sp.cards.every((c) => c.takenBy === null));
    assert.equal(JSON.stringify({ pub, priv }), before);
    assert.equal(shopBlockReason('ready', { priv, editable: true }), '请先完成教鞭选择');
    assert.equal(shopBlockReason('ready', { priv: { ...priv, temp: [{}] }, editable: true }), '请先完成教鞭选择');
    assert.match(shopBlockReason('ready', { priv: { ...priv, personalChoice: null }, editable: true }), /临时整备区/);
    for (const phase of [PHASE.SP_DRAFT, PHASE.COMBAT, PHASE.ROUND_START]) assert.equal(normalizePersonalChoice({ ...pub, phase }, priv, 'a'), null);
    assert.equal(normalizePersonalChoice(pub, null, 'a'), null, 'spectator has no private state');
    assert.equal(normalizePersonalChoice(pub, priv, 'b'), null);
    assert.equal(normalizePersonalChoice(pub, { ...priv, alive: false }, 'a'), null);
    assert.equal(normalizePersonalChoice({ ...pub, round: 15 }, priv, 'a'), null);
    assert.equal(normalizePersonalChoice(pub, { ...priv, personalChoice: null }, 'a'), null);
  });
});

describe('fields, players, emotes', () => {
  const pub = {
    players: [{ playerId: 'p2', seat: 1, name: 'B' }, { playerId: 'p1', seat: 0, name: 'A', fieldId: 'n:p1' }, null],
    fields: [{ fieldId: 'n:p1', kind: 'normal', players: ['p1'], live: true }, { fieldId: 'n:p2', kind: 'normal', players: ['p2'], live: true },
      { fieldId: 'u', kind: 'unite', players: ['p2'], live: false }],
  };
  test('sortedPlayers by seat, junk dropped', () => {
    assert.deepEqual(sortedPlayers(pub).map((p) => p.playerId), ['p1', 'p2']);
    assert.deepEqual(sortedPlayers(null), []);
  });
  test('cycleField wraps over live fields only', () => {
    assert.equal(cycleField(pub.fields, 'n:p1', 1), 'n:p2');
    assert.equal(cycleField(pub.fields, 'n:p2', 1), 'n:p1');
    assert.equal(cycleField(pub.fields, 'n:p1', -1), 'n:p2');
    assert.equal(cycleField(pub.fields, 'zzz', 1), 'n:p1');
    assert.equal(cycleField([], 'n:p1', 1), null);
  });
  test('fieldLabel / homeFieldId', () => {
    assert.equal(fieldLabel(pub.fields[0], pub, 'p1'), '自己');
    assert.equal(fieldLabel(pub.fields[1], pub, 'p1'), 'B');
    assert.equal(fieldLabel({ fieldId: 'b1', kind: 'boss', players: ['p1', 'p2'] }, pub, 'p1'), '全景');
    assert.equal(fieldLabel({ fieldId: 'b2', kind: 'boss', players: ['p2'] }, pub, 'p1'), 'B');
    assert.equal(fieldLabel({ fieldId: 'u', kind: 'unite', players: ['p2'] }, pub, 'p1'), '联防阵地');
    assert.equal(homeFieldId(pub, 'p1'), 'n:p1');
    assert.equal(homeFieldId({ ...pub, fields: [{ fieldId: 'b1', kind: 'boss', players: ['p1'], live: true }] }, 'p1'), 'b1');
    assert.equal(homeFieldId({}, 'zz'), 'n:zz');
  });
  test('activeBubbles keeps the newest emote per player within ttl', () => {
    const now = 10_000;
    const m = activeBubbles([{ seq: 1, playerId: 'a', id: 'hello', at: 8_000 }, { seq: 2, playerId: 'a', id: 'thanks', at: 9_000 },
      { seq: 3, playerId: 'b', id: 'wow', at: 5_000 }, null], now, 3000);
    assert.equal(m.get('a').id, 'thanks'); assert.equal(m.has('b'), false);
    assert.equal(activeBubbles(undefined, now).size, 0);
  });
});

describe('enemies, HUD, stats', () => {
  const enemies = { e1: { name: '甲', rank: 'NORMAL', stats: { motion: 'WALK' } }, e2: { name: '乙', rank: 'ELITE', acTypes: ['FLY'], stats: { motion: 'FLY' } }, e3: { name: '丙', rank: 'BOSS' } };
  test('groupEnemies merges and orders boss → bounty → elite → normal', () => {
    const rows = groupEnemies([{ enemyKey: 'e1', count: 3 }, { enemyKey: 'e1', count: 2 }, { enemyKey: 'e2', count: 1 }, { enemyKey: 'e3', count: 1, tag: 'boss' },
      { enemyKey: 'e1', count: 1, tag: 'bounty' }, { bogus: 1 }, null], (k) => enemies[k]);
    assert.deepEqual(rows.map((r) => `${r.enemyKey}:${r.tag}:${r.count}`), ['e3:boss:1', 'e1:bounty:1', 'e2:null:1', 'e1:null:5']);
    assert.equal(rows[2].fly, true); assert.deepEqual(rows[2].acTypes, ['FLY']);
    assert.equal(groupEnemies([{ enemyKey: 'x', count: -4 }])[0].count, 1);
  });
  test('factionTypes accepts strings and objects', () => {
    assert.deepEqual(factionTypes(['FLY', { type: 'TIMES' }, { id: 'SPECIAL' }, 'FLY', 3, null]), ['FLY', 'TIMES', 'SPECIAL']);
  });
  test('snapHud / bossFrac', () => {
    assert.deepEqual(snapHud({ killed: 3, total: 9, dp: 20 }), { killed: 3, resolved: 3, total: 9, dp: 20, boss: null });
    // the capsule's numerator: the field's own enemies knocked out or leaked (a runtime split / summon knocked down
    // counts in `killed` only, so the two may differ — 5/9 down but 3/9 of the round's own list resolved)
    assert.deepEqual(snapHud({ killed: 5, resolved: 3, total: 9, dp: 20 }), { killed: 5, resolved: 3, total: 9, dp: 20, boss: null });
    assert.deepEqual(snapHud({ boss: { hp: 50, max: 200 } }).boss, { hp: 50, max: 200 });
    assert.equal(snapHud(null), null);
    assert.equal(bossFrac({ hp: 50, max: 200 }), 0.25);
    assert.equal(bossFrac({ hp: 500, max: 200 }), 1);
    assert.equal(bossFrac({ hp: 5, max: 0 }), null);
    assert.equal(bossFrac(null), null);
  });
  test('attackInterval, fmtNum, rangeGridBox', () => {
    assert.equal(attackInterval(1, 100), 1);
    assert.equal(attackInterval(1.2, 120), 1);
    assert.equal(attackInterval(0, 100), null);
    assert.equal(attackInterval(1, 0), 1, 'bad aspd falls back to 100');
    assert.equal(fmtNum(12345), '12,345');
    assert.equal(fmtNum(2_310_000), '231万');
    assert.equal(fmtNum(150_000), '15.0万');
    assert.equal(fmtNum('x'), '—');
    const box = rangeGridBox([[1, 0], [0, 1], [-1, 2]]);
    assert.equal(box.rows, 3); assert.equal(box.cols, 3); assert.ok(box.cells.has('0,1'));
    const mir = rangeGridBox([[0, 2]], true);
    assert.ok(mir.cells.has('0,-2'));
    assert.equal(rangeGridBox(null).cells.size, 0);
  });
});

describe('keyboard & settings', () => {
  test('shortcutFor', () => {
    assert.equal(shortcutFor({ key: 'r', code: 'KeyR' }), 'refresh');
    assert.equal(shortcutFor({ key: 'F', code: 'KeyF' }), 'freeze');
    assert.equal(shortcutFor({ key: 'd' }), 'levelUp');
    assert.equal(shortcutFor({ key: 'q', code: 'KeyQ' }), 'retreat');
    assert.equal(shortcutFor({ key: 'Q' }), 'retreat');
    assert.equal(shortcutFor({ code: 'KeyX' }), 'sell');
    assert.equal(shortcutFor({ key: 'X' }), 'sell');
    for (const key of ['q', 'x']) {
      assert.equal(shortcutFor({ key, repeat: true }), null);
      assert.equal(shortcutFor({ key, ctrlKey: true }), null);
      assert.equal(shortcutFor({ key, metaKey: true }), null);
      assert.equal(shortcutFor({ key, altKey: true }), null);
      for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
        assert.equal(shortcutFor({ key, target: { tagName } }), null);
      }
      assert.equal(shortcutFor({ key, target: { isContentEditable: true } }), null);
    }
    assert.equal(shortcutFor({ key: ' ', code: 'Space' }), 'ready');
    assert.equal(shortcutFor({ key: 'Escape' }), 'escape');
    assert.equal(shortcutFor({ key: 'r', ctrlKey: true }), null);
    assert.equal(shortcutFor({ key: 'r', repeat: true }), null);
    assert.equal(shortcutFor({ key: 'Escape', repeat: true }), 'escape');
    assert.equal(shortcutFor({ key: 'r', target: { tagName: 'input' } }), null);
    assert.equal(shortcutFor({ key: ' ', code: 'Space', target: { tagName: 'BUTTON' } }), 'ready', 'space readies even with a HUD button focused');
    assert.equal(shortcutFor({ key: ' ', code: 'Space', target: { tagName: 'TEXTAREA' } }), null);
    assert.equal(shortcutFor({ key: 'd', target: { tagName: 'DIV', isContentEditable: true } }), null);
    assert.equal(shortcutFor({ key: 'z' }), null);
    assert.equal(shortcutFor(null), null);
  });
  test('sanitizeSettings', () => {
    assert.deepEqual(sanitizeSettings(null), { ...DEFAULT_SETTINGS });
    assert.deepEqual(sanitizeSettings({ bgm: 3, sfx: -1, voice: 2, muted: 'yes', damageNumbers: false, quality: 'ultra' }),
      { bgm: 1, sfx: 0, voice: 1, voiceLang: 'cn', voiceOverrides: {}, muted: false, damageNumbers: false, quality: 'high', textSize: 'sm', keys: { ...DEFAULT_SETTINGS.keys } },
      'a saved profile without `keys` (before 0.2.0) gets the default key map (test/ui/feedback5-hotkeys.test.js)');
    assert.equal(sanitizeSettings({ bgm: 0.5 }).voice, DEFAULT_SETTINGS.voice, 'a saved profile without `voice` gets the default');
    // 语音语言 (0.2.2): 中文 by default — a profile saved before it, or any other value, plays the Chinese dub
    assert.equal(DEFAULT_SETTINGS.voiceLang, 'cn');
    assert.equal(sanitizeSettings({ bgm: 0.5 }).voiceLang, 'cn');
    assert.equal(sanitizeSettings({ voiceLang: 'jp' }).voiceLang, 'jp');
    for (const bad of ['en', 'kr', 'JP', 'ja', 1, null]) assert.equal(sanitizeSettings({ voiceLang: bad }).voiceLang, 'cn', String(bad));
    assert.equal(sanitizeSettings({ bgm: 0.333 }).bgm, 0.33);
    assert.equal(sanitizeSettings({ quality: 'low' }).quality, 'low');
  });
});

describe('result', () => {
  test('normalizeResult fills from m.public and sorts by seat', () => {
    const pub = { lastRound: 14, difficulty: 'HARD', players: [{ playerId: 'b', seat: 1, name: 'B', lp: 4, bandId: 'band_x' }, { playerId: 'a', seat: 0, name: 'A' }] };
    const r = normalizeResult({ victory: true, roundsPassed: 14, players: [{ playerId: 'b', title: 'comment_2', lineup: [{ id: 'c1' }], stats: { kills: 3 } }, { playerId: 'a', title: { id: 'comment_1', name: '卫戍之星' } }, null] }, pub);
    assert.equal(r.victory, true);
    assert.deepEqual(r.players.map((p) => p.playerId), ['a', 'b']);
    assert.equal(r.players[1].bandId, 'band_x');
    assert.equal(r.players[1].lp, 4);
    assert.deepEqual(r.players[1].title, { id: 'comment_2' });
    assert.equal(r.players[0].title.name, '卫戍之星');
    assert.equal(r.difficulty, 'HARD');
    const empty = normalizeResult(null, null);
    assert.equal(empty.victory, false); assert.deepEqual(empty.players, []); assert.equal(empty.lastRound, 14);
    assert.equal(normalizeResult({ players: [{ playerId: 'x', roundsPassed: 9 }] }, null).roundsPassed, 9);
  });
});

describe('prepCamera (research 09 §1.2: the Final Assault prep on the own half of the boss field)', () => {
  const pl = (id, seat, alive = true) => ({ playerId: id, seat, alive });
  const pub = (round, players) => ({ round, bossRound: 14, hiddenRound: 15, players });
  test('normal rounds: the own board', () => {
    const c = prepCamera(pub(6, [pl('a', 0), pl('b', 1)]), 'b');
    assert.deepEqual(c, { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L' } });
    assert.equal(prepCamera(null, 'a').kind, 'prep');
    assert.equal(prepCamera({ round: 14, bossRound: null, hiddenRound: null, players: [] }, 'a').kind, 'prep');
  });
  test('boss / hidden round prep: bossPrep on the side of the server pairing (alive players by seat, two by two)', () => {
    const players = [pl('d', 3), pl('a', 0), pl('c', 2), pl('b', 1)];
    for (const round of [14, 15]) {
      const sides = Object.fromEntries(players.map((p) => [p.playerId, prepCamera(pub(round, players), p.playerId)]));
      assert.deepEqual(Object.fromEntries(Object.entries(sides).map(([k, v]) => [k, `${v.kind}:${v.opts.side}`])),
        { a: 'bossPrep:L', b: 'bossPrep:R', c: 'bossPrep:L', d: 'bossPrep:R' });
    }
    // somebody left (eliminated): the pairs close up exactly like the server's (Match._quit re-plans the boss waves)
    const left = [pl('a', 0), pl('b', 1, false), pl('c', 2), pl('d', 3)];
    const groups = pairPlayers(left.filter((p) => p.alive).map((p) => ({ ...p })));
    for (const g of groups) g.forEach((p, j) => assert.equal(prepCamera(pub(14, left), p.playerId).opts.side, j === 1 ? 'R' : 'L', p.playerId));
    assert.equal(prepCamera(pub(14, left), 'c').opts.side, 'R', 'c moves up to the right half');
    assert.equal(prepCamera(pub(14, left), 'b').kind, 'prep', 'an eliminated player has no half');
    // solo / a lone last player: the left half
    assert.deepEqual(prepCamera(pub(14, [pl('a', 0)]), 'a'), { kind: 'bossPrep', opts: { side: 'L' } });
  });
});

// user playtest #4 item 1: a dragged item drops on the tile under the pointer (render/drag.js) and goes to the unit on
// that tile — the highlighted tile; nothing is retargeted to a sprite drawn over another tile any more
describe('equipment dropped on a tile goes to the unit on it', () => {
  test('the operator on the drop tile (board or bench), not the one whose head is drawn there; an empty tile says why', () => {
    const front = { ...piece(RANGED), row: 9, col: 3 }, behind = { ...piece(RANGED), row: 10, col: 3 };
    const onBench = piece(RANGED);
    const eq = item(EQUIP), art = item(MAGIC);
    const ctx = ctxFor(privWith({ board: [front, behind], hand: [{ idx: 0, piece: eq }, { idx: 1, piece: art }, { idx: 4, piece: onBench }] }));
    assert.deepEqual(dropIntent(ctx, eq.uid, { area: 'board', row: 9, col: 3 }).fields, { itemUid: eq.uid, targetUid: front.uid });
    assert.deepEqual(dropIntent(ctx, eq.uid, { area: 'board', row: 10, col: 3 }).fields, { itemUid: eq.uid, targetUid: behind.uid });
    assert.deepEqual(dropIntent(ctx, eq.uid, { area: 'hand', idx: 4 }).fields, { itemUid: eq.uid, targetUid: onBench.uid }, 'a bench operator');
    // the empty tile behind `behind` (where its head is drawn) takes nothing — and the release says why
    assert.equal(dropIntent(ctx, eq.uid, { area: 'board', row: 11, col: 3 }), null);
    assert.equal(dropFailureReason(ctx, eq.uid, { row: 11, col: 3, area: 'board' }), '请将装备拖拽至干员身上');
    // an Art is used on the tile under the pointer itself
    assert.deepEqual(dropIntent(ctx, art.uid, { area: 'board', row: 11, col: 3 }), { t: 'g.art', fields: { itemUid: art.uid, row: 11, col: 3 } });
  });
});

// GitHub issue #184 「建议加入对于特殊地形的单击信息提示」: tapping a special terrain tile explains it — in the stage's own
// numbers (the same bb / special parameters the sim runs on), while an ordinary tile says nothing at all.
describe('special terrain tip', () => {
  /** The first (row, col) of `glyph` in a real stage of data/stages.json. */
  const at = (stageId, glyph) => {
    const st = stages[stageId];
    for (let row = 0; row < st.rows.length; row++) {
      const col = st.rows[row].indexOf(glyph);
      if (col >= 0) return { st, row, col };
    }
    throw new Error(`no ${glyph} in ${stageId}`);
  };

  test('each terrain of the mode, with the numbers of the stage it stands on', () => {
    // 活性源石 (战场#04): the official tile parameters (damage 70/s, +20% ATK, +20 ASPD, 300 s)
    const inf = at('act1autochess_m04', 'i');
    const tip = terrainInfo(inf.st, inf.row, inf.col);
    assert.equal(tip.key, 'infection');
    assert.equal(tip.name, '活性源石');
    assert.equal(tip.tag, '特殊地形');
    assert.deepEqual([tip.row, tip.col], [inf.row, inf.col]);
    assert.match(tip.lines[0], /每秒受到 70 点真实伤害/, 'damage from the stage\'s own bb');
    assert.match(tip.lines[1], /攻击力 \+20%、攻击速度 \+20/);
    assert.match(tip.lines[2], /300 秒/);
    assert.deepEqual(tip.facts, ['可部署', '地面单位可通过']);
    // 沼泽 (战场#06): one 陷入沼泽 layer a second, −5% ASPD (−5% move for enemies), 2 layers at 重量 ≥ 3, 10 at most
    const mire = terrainInfo(...(() => { const g = at('act2autochess_m02', 'm'); return [g.st, g.row, g.col]; })());
    assert.equal(mire.name, '沼泽');
    assert.ok(mire.lines.some((l) => /攻击速度 −5%/.test(l) && /移动速度 −5%/.test(l)));
    assert.ok(mire.lines.some((l) => /重量 ≥ 3 的敌人一次获得 2 层/.test(l)));
    assert.ok(mire.lines.some((l) => /最多 10 层/.test(l)));
    // 排气格栅 (战场#07): the 隐匿-like rule and its limit — the enemy it blocks still hits it (review on #185)
    const smog = at('act2autochess_m03', 'g');
    const smogTip = terrainInfo(smog.st, smog.row, smog.col);
    assert.equal(smogTip.name, '排气格栅');
    assert.match(smogTip.lines[0], /不会被敌方的远程攻击选中（效果相当于隐匿）/);
    assert.match(smogTip.lines[1], /挡住敌人的干员仍会被它攻击到/);
    // 深水区 (战场#05): drowning numbers, and 拒绝部署 although the level's own buildableType is ALL (grid.js)
    const sea = at('act1autochess_m05', 'd');
    const seaTip = terrainInfo(sea.st, sea.row, sea.col);
    assert.equal(seaTip.name, '深水区');
    assert.ok(seaTip.lines.some((l) => /每秒受到 40 点伤害/.test(l)));
    assert.ok(seaTip.lines.some((l) => /攻击速度 −60%/.test(l) && /移动速度 ×0.6/.test(l)));
    // …and what that damage IS: sourceless, and not 环境伤害 (devices.js tickDeepsea; review on #185)
    assert.ok(seaTip.lines.some((l) => /无来源伤害/.test(l) && /不归类为环境伤害/.test(l)));
    assert.ok(seaTip.lines.some((l) => /拒绝部署/.test(l)));
    assert.ok(seaTip.facts.includes('不可部署'));
    // the gates and teleports every stage carries (tile_start / tile_end / tile_telin / tile_telout)
    for (const [glyph, name] of [['S', '红门'], ['E', '蓝门'], ['I', '传送入口'], ['O', '传送出口']]) {
      const g = at('act1autochess_m04', glyph);
      const t = terrainInfo(g.st, g.row, g.col);
      assert.equal(t.name, name, glyph);
      assert.ok(t.lines.length >= 1);
    }
  });

  test('an ordinary tile says nothing (the press keeps its other meanings); nonsense input is safe', () => {
    const st = stages['act1autochess_m04'];
    const inf = at('act1autochess_m04', 'i');
    assert.ok(terrainInfo(inf.st, inf.row, inf.col), 'the stage does carry one tile that answers');
    // every non-special glyph the stage uses: the bench, the blocked rows, road / floor, the fence, the separator…
    for (const glyph of ['a', 'A', '#', 'X', 'r', 'f', 'b', 'h', 'p']) {
      let found = null;
      for (let row = 0; row < st.rows.length && !found; row++) {
        const col = st.rows[row].indexOf(glyph);
        if (col >= 0) found = { row, col };
      }
      if (!found) continue;                       // a glyph this stage does not use says nothing to test
      assert.equal(terrainInfo(st, found.row, found.col), null, glyph);
    }
    assert.equal(terrainInfo(inf.st, -1, inf.col), null);
    assert.equal(terrainInfo(inf.st, inf.st.rows.length, 0), null);
    assert.equal(terrainInfo(inf.st, inf.row, 999), null);
    assert.equal(terrainInfo(inf.st, 1.5, 2), null);
    assert.equal(terrainInfo(inf.st, '3', 2), null);
    assert.equal(terrainInfo(null, 0, 0), null);
    assert.equal(terrainInfo(undefined, 0, 0), null);
    assert.equal(terrainInfo({}, 0, 0), null);
    // a stage without the tile legend (or without that glyph) explains nothing rather than guessing
    assert.equal(terrainInfo({ rows: ['i'] }, 0, 0), null);
    assert.equal(terrainInfo({ rows: ['i'], tiles: {} }, 0, 0), null);
    assert.equal(terrainInfo({ rows: ['i'], tiles: { i: null } }, 0, 0), null);
    // …and a legend entry the mode never gave a tip (its own ordinary floor) is not a tip either
    assert.equal(terrainInfo({ rows: ['z'], tiles: { z: { tileKey: 'tile_floor', special: null } } }, 0, 0), null);
  });

  test('the facts come from the tile\'s own legend entry; missing terrain parameters never crash', () => {
    const stage = {
      rows: ['ih'],
      tiles: {
        i: { tileKey: 'tile_infection', height: 'LOW', buildable: 'RANGED', groundPassable: false, special: 'infection' },
        h: { tileKey: 'tile_smog', height: 'HIGH', buildable: 'NONE', groundPassable: false, special: 'smog' },
      },
      special: {},
    };
    assert.deepEqual(terrainInfo(stage, 0, 0).facts, ['仅远程位可部署', '只有空中单位能通过']);
    assert.deepEqual(terrainInfo(stage, 0, 1).facts, ['不可部署', '高台', '只有空中单位能通过']);
    // a stage whose `special` is missing: the mechanism is still explained, just without the stage's numbers
    const bare = { rows: ['ih'], tiles: stage.tiles };
    assert.deepEqual(terrainInfo(bare, 0, 0).lines, ['在其上的我方单位与经过的敌方单位持续受到伤害']);
    assert.deepEqual(terrainInfo(bare, 0, 1).lines, ['站在排气格栅上的干员不会被敌方的远程攻击选中（效果相当于隐匿）', '但挡住敌人的干员仍会被它攻击到']);
    // 沼泽 without its parameters falls back to the official template numbers
    const mire = { rows: ['m'], tiles: { m: { tileKey: 'tile_mire', height: 'LOW', buildable: 'ALL', groundPassable: true, special: 'mire' } } };
    assert.match(terrainInfo(mire, 0, 0).lines[0], /每 1 秒获得 1 层/);
    assert.match(terrainInfo(mire, 0, 0).lines[2], /最多 10 层/);
  });
});
