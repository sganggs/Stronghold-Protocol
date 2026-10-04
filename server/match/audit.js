// server/match/audit.js — rule auditor for sweeps and tests (tools/matchrun.mjs --check, test/match/fullmatch.test.js).
//
// attachAudit(m) wraps a live Match's phase transitions and a few prep handlers (instance-level wrappers; the engine
// is untouched) and records every rule violation it observes, next to the structural invariants of invariants.js:
//   temp          (临时整备区) every piece entering a temp slot (PlayerState._putTemp) is due at the deadline of the first
//                 prep in which its player could act on it: the current prep when it arrived in PREP before Ready,
//                 the next one when it arrived after Ready / at the prep end, else (COMBAT, SETTLE, ROUND_START, 机变)
//                 the next prep to end; a piece that got into temp by other means counts as due at the prep in
//                 progress when it is first seen at a prep end. No temp piece may outlive its due prep.
//   prep end      leftover funds lost (carry bands excepted), temp resolved (only pieces due at a later prep stay),
//                 reward offers expired
//   round start   income = config income(r) (= min(3 + r, 12)) + pending funds, upgrade price −1 (floor 0) from R2,
//                 temp not wiped (nothing overdue), offers earned after the last prep kept, frozen slots kept in
//                 place (same id; chess slots keep their index, the item slot(s) follow the chess slots, so a
//                 level-up moves them right), everything else rerolled with tier ≤ shop level from the unbanned pool,
//                 freeze toggle released
//   prep handlers buy / sell / refresh / levelUp pay exactly price / +sell price / refresh price (free first) / level
//                 price, the level rises by one and its price resets to the next base; Ready only with an empty temp
//   merges        a merge consuming a deployed copy puts the elite on that copy's tile (of several, the first in deploy
//                 order legal for it — board.js mergeTile; a 突变细胞 carrier destroyed before the gain is no copy) with
//                 its facing, else into the hand / temp; the deploy count never grows (PRTS 卫戍协议/帮助, user playtest
//                 #6 follow-up)
//   combat start  nothing overdue in temp, everyone ready, funds lost (carry bands excepted), unfrozen shop cleared,
//                 one field per alive player
//   drafts        every seat holds an allowed band with LP = totalHp; 机变: one card per alive player, card ↔ picker
//                 maps consistent, 6 (co-op) / 3 (solo) cards
//   联防          decided after the COMBAT_END pause from the players still in: runs iff co-op with ≥ 1 leaker and
//                 ≥ 1 perfect player; helpers = unite.js helperOrder (PRTS: units > active bond > layers > standing
//                 units > seat, research 08 §5); leakers = players with counted leaks
//   settle        no unite ⇒ loss = min(cap, counted leaks); after 联防 a leaker loses ≤ cap (its leaked enemies'
//                 offspring count too), everybody else ≤ min(cap, own counted leaks); LP ≤ 0 ⇔ eliminated
//   final assault fields pair alive players by seat, team LP = Σ alive LP, boss pool = bossPoolHp(); hidden core only
//                 after a win when hiddenEligible() holds
//   result        each title ≤ once, ≤ 1 title per player, onlyOnWin titles only on a win, roundsPassed per player,
//                 Σ alive players' LP = the merged team LP after the Final Assault
//   deadlines     every timed phase's m.public deadline equals its configured duration × timerScale; the co-op
//                 strategy draft has one countdown: the deadline is the current turn's (Match.BAND_TURN_SECONDS). A match
//                 with a single human (solo, or a 同盟 room with AI teammates only: Match.soloUntimed) times nothing
//                 outside its battles — no INFO_CHECK / draft / 机变 / prep deadline, BATTLE_CHECK / ROUND_START / SETTLE
//                 silent (deadline 0)
// Checks never throw into the match: an exception inside a check is itself recorded as a violation.

import { PHASE } from '../../shared/constants.js';
import { collectViolations } from './invariants.js';
import { mergeTile, pieceDir, canPlace, placeClass } from './board.js';
import { pairPlayers, bossPoolHp, hiddenEligible } from './finalAssault.js';
import { helperOrder } from './unite.js';
import { BAND_TURN_SECONDS } from './Match.js';

/**
 * @param {import('./Match.js').Match} m
 * @param {{ invariants?: boolean, limit?: number }} [opts] invariants: also run collectViolations at phase changes
 */
export function attachAudit(m, { invariants = true, limit = 200 } = {}) {
  const gd = m.gd;
  const audit = {
    violations: [],
    checks: 0,
    /** shop tier histogram of rolled chess slots: level → { tier: n } */
    odds: {},
    phases: 0,
  };
  const where = () => `${m.phase} R${m.round}`;
  const fail = (msg) => { if (audit.violations.length < limit) audit.violations.push(`[${where()}] ${msg}`); };
  const check = (label, fn) => {
    audit.checks++;
    try { fn(); } catch (e) { fail(`audit ${label} threw: ${e && e.message}`); }
  };
  const carries = (ps) => gd.leftoverKeptBands.includes(ps.bandId);
  const wrap = (obj, name, around) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function wrapped(...args) { return around.call(this, orig.bind(this), ...args); };
  };
  const expectDeadline = (seconds, label, { silentSolo = false } = {}) => check(`deadline ${label}`, () => {
    // a solo match's presentation steps run silently (no countdown, Match.soloUntimed)
    const want = seconds > 0 && !(silentSolo && m.soloUntimed) ? Math.max(0, Math.round(seconds * 1000 * m.timerScale)) : 0;
    const got = m.deadline ? m.deadline - m.sched.now() : 0;
    if (Math.abs(got - want) > 1) fail(`${label}: deadline in ${got} ms, expected ${want} ms`);
  });
  const runInvariants = () => {
    if (!invariants) return;
    audit.phases++;
    for (const v of collectViolations(m, { limit: 10 })) fail(`invariant: ${v}`);
  };

  // ---- per-player prep handlers and round start --------------------------------------------------------------
  const incomeEv = new Map();
  wrap(m, 'dispatch', function (orig, ps, hook, ev, opts) {
    if (hook === 'onIncome' && ev && ps) incomeEv.set(ps, { initial: { income: ev.income, pending: ev.pending }, ev });
    return orig(ps, hook, ev, opts);
  });
  // temp arrivals: ps → Map(uid → index of the prep whose deadline resolves it); ps → preps ended (own count)
  const tempDue = new Map();
  const prepsEnded = new Map();
  const endedOf = (ps) => prepsEnded.get(ps) || 0;
  const dueOf = (ps) => { let d = tempDue.get(ps); if (!d) tempDue.set(ps, (d = new Map())); return d; };
  const overdue = (ps, label) => {
    const d = dueOf(ps);
    for (const p of ps.temp) {
      if (!p) continue;
      const due = d.get(p.uid);
      if (due != null && due < endedOf(ps)) fail(`${ps.playerId}: temp piece ${p.id} (due at prep ${due}) survived ${label} (${endedOf(ps)} preps ended)`);
    }
  };
  for (const ps of m.players.values()) {
    wrap(ps, '_putTemp', function (orig, i, piece) {
      const res = orig(i, piece);
      // after Ready / at the prep end the player cannot act on it any more: due at the next prep
      if (piece) dueOf(ps).set(piece.uid, endedOf(ps) + (m.phase === PHASE.PREP && ps.ready ? 1 : 0));
      return res;
    });
    wrap(ps, 'setReady', function (orig, on) {
      const was = ps.ready;
      const res = orig(on);
      // un-ready: the player can act on what arrived while it was ready — due at this prep again
      if (res && res.ok && was && !on) for (const p of ps.temp) if (p && (dueOf(ps).get(p.uid) ?? 0) > endedOf(ps)) dueOf(ps).set(p.uid, endedOf(ps));
      if (res && res.ok && on) check('ready', () => { if (!ps.tempEmpty) fail(`${ps.playerId}: ready with a non-empty temp`); });
      return res;
    });
    wrap(ps, '_rollChessSlot', function (orig) {
      const s = orig();
      if (s) {
        const t = gd.tierOf(s.id);
        const row = (audit.odds[ps.shop.level] ||= {});
        row[t] = (row[t] || 0) + 1;
        check('shop roll', () => {
          const base = gd.baseIdOf(s.id);
          if (t > ps.shop.level) fail(`${ps.playerId}: rolled tier ${t} at shop level ${ps.shop.level}`);
          if (!m.pool.has(base)) fail(`${ps.playerId}: rolled ${s.id} outside the match pool (banned/hidden)`);
          if (s.basePrice !== gd.chessPrice(s.id)) fail(`${ps.playerId}: ${s.id} basePrice ${s.basePrice} != ${gd.chessPrice(s.id)}`);
        });
      }
      return s;
    });
    wrap(ps, 'startRound', function (orig, r) {
      const f0 = ps.funds;
      const p0 = ps.pendingFunds;
      const up0 = ps.shop.upgradePrice;
      const kept = ps.shop.slots.map((s, i) => (s ? { i, kind: s.kind, id: s.id, frozen: !!s.frozen, sold: !!s.sold } : null)).filter(Boolean);
      const offers0 = ps.offers.slice();
      const layout0 = ps.shop.layout || { chess: ps.shop.slots.length, item: 0 };
      incomeEv.delete(ps);
      const res = orig(r);
      check('round start', () => {
        const id = ps.playerId;
        const inc = incomeEv.get(ps);
        const want = gd.income(r);
        if (want !== Math.min(3 + r, 12) && !gd.economy.income) fail(`income(${r}) ${want}`);
        if (!inc) fail(`${id}: no onIncome dispatch`);
        else {
          if (inc.initial.income !== want || inc.initial.pending !== p0) fail(`${id}: onIncome started with ${inc.initial.income}+${inc.initial.pending}, expected ${want}+${p0}`);
          const nn = (v) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
          const credited = nn(inc.ev.income) + nn(inc.ev.pending);
          if (ps.funds - f0 !== credited) fail(`${id}: funds ${f0} → ${ps.funds}, credited ${credited}`);
        }
        const upWant = r > 1 ? Math.max(0, up0 - 1) : up0;
        if (ps.shop.upgradePrice !== upWant) fail(`${id}: upgrade price ${up0} → ${ps.shop.upgradePrice}, expected ${upWant}`);
        if (ps.pendingFunds !== 0) fail(`${id}: pending funds not cleared`);
        // temp is not wiped here: what overflowed after the last prep's deadline is shown in this prep
        overdue(ps, 'the round start');
        // offers of the last prep expired at its end; the ones queued after it (SETTLE merges) wait for this prep
        if (offers0.some((o) => !ps.offers.includes(o))) fail(`${id}: a reward offer earned after the prep was dropped at the round start`);
        if (ps.shop.frozen) fail(`${id}: freeze toggle still on after the round start`);
        const { chess, item } = gd.shopSlots(ps.shop.level);
        if (ps.shop.slots.length !== chess + item) fail(`${id}: ${ps.shop.slots.length} shop slots at level ${ps.shop.level}, expected ${chess}+${item}`);
        for (const k of kept) {
          if (!k.frozen || k.sold) { fail(`${id}: slot ${k.i} (${k.id}) survived combat unfrozen/sold`); continue; }
          // chess slots keep their index; item slots keep their place after the chess slots (whose count may have grown)
          const at = k.i < layout0.chess ? k.i : chess + (k.i - layout0.chess);
          const s = ps.shop.slots[at];
          if (!s || s.id !== k.id || s.kind !== k.kind) fail(`${id}: frozen slot ${k.i} (${k.id}) not kept in place (slot ${at} now ${s ? s.id : 'empty'})`);
        }
        for (const s of ps.shop.slots) if (s && s.frozen) fail(`${id}: slot ${s.id} still frozen after the round start`);
      });
      return res;
    });
    // exact payment checks are skipped when content could pay out / refund around the action (checked before & after)
    wrap(ps, 'buy', function (orig, slotIdx) {
      const slot = ps.shop.slots[slotIdx];
      const price = slot && !slot.sold ? ps.priceOf(slot) : null;
      const f0 = ps.funds;
      const fx = hasSpendEffects(m, ps);
      const res = orig(slotIdx);
      if (res && res.ok) check('buy', () => {
        if (!slot || !slot.sold) fail(`${ps.playerId}: bought slot ${slotIdx} is not marked sold`);
        if (ps.funds !== f0 - price && !fx && !hasSpendEffects(m, ps)) fail(`${ps.playerId}: buy paid ${f0 - ps.funds}, price ${price}`);
      });
      return res;
    });
    wrap(ps, 'sell', function (orig, uid) {
      const loc = ps.find(uid);
      const gain = loc && loc.piece.kind === 'chess' ? gd.sellPrice(loc.piece.id) : null;
      const f0 = ps.funds;
      const fx = hasSpendEffects(m, ps);
      const res = orig(uid);
      if (res && res.ok) check('sell', () => {
        if (ps.funds - f0 !== gain && !fx && !hasSpendEffects(m, ps)) fail(`${ps.playerId}: sell paid ${ps.funds - f0}, expected ${gain}`);
        if (ps.find(uid)) fail(`${ps.playerId}: sold piece ${uid} still owned`);
      });
      return res;
    });
    wrap(ps, 'refresh', function (orig) {
      const free = ps.shop.freeRefreshes > 0;
      const f0 = ps.funds;
      const fr0 = ps.shop.freeRefreshes;
      const fx = hasSpendEffects(m, ps);
      const res = orig();
      if (res && res.ok && !fx && !hasSpendEffects(m, ps)) check('refresh', () => {
        const paid = f0 - ps.funds;
        if (free ? paid !== 0 || ps.shop.freeRefreshes !== fr0 - 1 : paid !== gd.refreshPrice) fail(`${ps.playerId}: refresh (free ${free}) paid ${paid}`);
      });
      return res;
    });
    wrap(ps, 'levelUp', function (orig) {
      const lv = ps.shop.level;
      const price = ps.shop.upgradePrice;
      const f0 = ps.funds;
      const fx = hasSpendEffects(m, ps);
      const res = orig();
      if (res && res.ok) check('levelUp', () => {
        if (ps.shop.level !== lv + 1) fail(`${ps.playerId}: level ${lv} → ${ps.shop.level}`);
        if (f0 - ps.funds !== price && !fx && !hasSpendEffects(m, ps)) fail(`${ps.playerId}: level-up paid ${f0 - ps.funds}, price ${price}`);
        const next = gd.upgradeBase(ps.shop.level) ?? 0;
        if (ps.shop.upgradePrice !== next) fail(`${ps.playerId}: upgrade price after level-up ${ps.shop.upgradePrice}, expected ${next}`);
      });
      return res;
    });
    // merges (PRTS 卫戍协议/帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置", user playtest #6 follow-up): with a
    // deployed copy among the consumed ones the elite stands on the first such tile in deploy order that is legal for
    // it, with that copy's facing; else in the hand / temp (the incoming copy is never deployed: a 突变细胞
    // transformation destroyed its carrier before the gain, so that freed tile is no copy's). A merge never grows the
    // deploy count. Every owned normal copy is consumed (merges are immediate).
    wrap(ps, '_mergeChess', function (orig, baseId, incoming) {
      const tiles = new Map(); // tile key → facing of the copy standing there
      for (const [k, p] of ps.board) if (p.kind === 'chess' && !gd.isGolden(p.id) && gd.baseIdOf(p.id) === baseId) tiles.set(k, pieceDir(p));
      const deployed0 = ps.deployCount;
      const elite = orig(baseId, incoming);
      if (elite) check('merge', () => {
        const id = ps.playerId;
        const loc = ps.find(elite.uid);
        if (!loc) { fail(`${id}: the elite of ${baseId} is not owned after its merge`); return; }
        if (ps.deployCount > deployed0) fail(`${id}: a merge of ${baseId} grew the deploy count ${deployed0} → ${ps.deployCount}`);
        // a pure read of the deploy field (Match.deployMapFor, as invariants.js): the audit must not refresh the cache
        const dmap = typeof m.deployMapFor === 'function' ? m.deployMapFor(ps) : ps.deployMap();
        const pos = placeClass(ps, gd.chess(elite.id));
        const want = mergeTile([...tiles.keys()].map((key) => ({ key })), (r, c) => canPlace(dmap, pos, r, c));
        if (want) {
          if (loc.area !== 'board' || loc.key !== want.key) fail(`${id}: the elite of ${baseId} went to ${loc.area} ${loc.key || ''}, expected the deployed copy's tile ${want.key}`);
          else if (pieceDir(elite) !== tiles.get(want.key)) fail(`${id}: the elite of ${baseId} faces ${pieceDir(elite)}, its copy faced ${tiles.get(want.key)}`);
        } else if (loc.area === 'board' && (!tiles.has(loc.key) || ps.hand.some((x) => x == null) || ps.temp.some((x) => x == null))) {
          // only the no-room fallback (hand and temp full, no deployed tile legal for it) leaves it on a copy's tile
          fail(`${id}: the elite of ${baseId} took tile ${loc.key} although no consumed copy stood on a legal tile`);
        }
      });
      return elite;
    });
    wrap(ps, 'endPrep', function (orig) {
      // a temp piece that got there by other means (not _putTemp) was in temp during this prep: due now
      for (const p of ps.temp) if (p && !dueOf(ps).has(p.uid)) dueOf(ps).set(p.uid, endedOf(ps));
      const res = orig();
      prepsEnded.set(ps, endedOf(ps) + 1);
      check('prep end', () => {
        // leftover funds are lost at prep end (carry bands excepted); gains after this (SETTLE effects) are kept
        if (ps.funds !== 0 && !carries(ps)) fail(`${ps.playerId}: kept ${ps.funds} funds past the prep end without a carry band`);
        overdue(ps, 'its prep end');
        if (ps.offers.length) fail(`${ps.playerId}: reward offer survived the prep end`);
      });
      return res;
    });
  }

  // ---- phases ------------------------------------------------------------------------------------------------
  wrap(m, 'enterInfoCheck', function (orig) {
    const r = orig();
    runInvariants();
    if (m.phase === PHASE.INFO_CHECK && m.soloUntimed) check('briefing', () => { if (m.deadline) fail('untimed briefing is timed'); });
    else if (m.phase === PHASE.INFO_CHECK && m.deadline) expectDeadline(gd.timer('infoCheck'), 'INFO_CHECK');
    return r;
  });
  wrap(m, 'enterBandDraft', function (orig) {
    const r = orig();
    runInvariants();
    check('band draft', () => {
      if (m.phase !== PHASE.BAND_DRAFT) return;
      const d = m.draft;
      const ids = m.order.map((p) => p.playerId).sort();
      if (JSON.stringify(d.order.slice().sort()) !== JSON.stringify(ids)) fail(`draft order ${d.order} != seats ${ids}`);
      // one countdown (user playtest #4 item 4): the step's deadline IS the current turn's, BAND_TURN_SECONDS long
      if (m.soloUntimed) { if (m.deadline || d.turnDeadline) fail('untimed band draft is timed'); } else {
        if (m.deadline !== d.turnDeadline) fail(`BAND_DRAFT: deadline ${m.deadline} is not the turn's ${d.turnDeadline}`);
        expectDeadline(BAND_TURN_SECONDS, 'BAND_DRAFT turn');
      }
    });
    return r;
  });
  wrap(m, 'enterBattleCheck', function (orig) {
    const r = orig();
    runInvariants();
    check('bands', () => {
      for (const ps of m.order) {
        if (!ps.bandId || !gd.bandAllowed(ps.bandId)) fail(`${ps.playerId}: band ${ps.bandId} not allowed`);
        if (ps.lp !== gd.startLp(ps.bandId)) fail(`${ps.playerId}: LP ${ps.lp} != totalHp ${gd.startLp(ps.bandId)} of ${ps.bandId}`);
      }
      expectDeadline(gd.timer('battleCheck'), 'BATTLE_CHECK', { silentSolo: true });
    });
    return r;
  });
  wrap(m, 'startRound', function (orig, rr) {
    const res = orig(rr);
    runInvariants();
    check('round start phase', () => {
      if (m.phase !== PHASE.ROUND_START) return;
      expectDeadline(2, 'ROUND_START', { silentSolo: true });
      const isBoss = rr === gd.bossRound || rr === gd.hiddenRound;
      if (isBoss ? !m.bossWaves : !m.wave) fail('round without its wave');
    });
    return res;
  });
  wrap(m, 'startSpTurn', function (orig) {
    const res = orig();
    check('sp turn', () => {
      if (m.phase !== PHASE.SP_DRAFT || !m.sp) return;
      const s = m.sp;
      if (s.idx >= s.order.length) return;
      if (m.soloUntimed) { if (m.deadline) fail('untimed 机变 is timed'); } else expectDeadline(s.idx === 0 ? gd.timer('spFirst') : gd.timer('spTurn'), `SP_DRAFT turn ${s.idx}`);
    });
    return res;
  });
  wrap(m, 'finishSpDraft', function (orig) {
    const s = m.sp;
    if (m.phase === PHASE.SP_DRAFT && s) check('sp draft', () => {
      const alive = m.alivePlayers().map((p) => p.playerId);
      const want = m.isSolo ? 3 : 6;
      if (s.cards.length > want) fail(`${s.cards.length} 机变 cards (max ${want})`);
      if (s.order.length !== alive.length) fail(`机变 order ${s.order.length} for ${alive.length} alive`);
      for (const pid of alive) {
        const idx = s.picks[pid];
        if (idx == null) fail(`${pid} ends 机变 without a card`);
        else if (s.taken[idx] !== pid) fail(`${pid} picked card ${idx} held by ${s.taken[idx]}`);
      }
      const holders = Object.values(s.taken);
      if (new Set(holders).size !== holders.length) fail('a player took two 机变 cards');
    });
    return orig();
  });
  wrap(m, 'enterPrep', function (orig) {
    const res = orig();
    runInvariants();
    check('prep', () => {
      if (m.phase !== PHASE.PREP) return;
      if (m.soloUntimed) { if (m.deadline) fail('untimed prep is timed'); } else if (!m._prepEndQueued) expectDeadline(gd.prepTime(m.round), 'PREP');
    });
    return res;
  });
  wrap(m, 'startCombat', function (orig) {
    const res = orig();
    runInvariants();
    check('combat start', () => {
      for (const ps of m.alivePlayers()) {
        const id = ps.playerId;
        overdue(ps, 'into combat');
        if (!ps.ready) fail(`${id}: not ready at combat start`);
        if (ps.funds !== 0 && !carries(ps)) fail(`${id}: kept ${ps.funds} funds into combat`);
        if (ps.offers.length) fail(`${id}: reward offer survived the prep`);
        for (const s of ps.shop.slots) if (s && (!s.frozen || s.sold)) fail(`${id}: unfrozen/sold slot ${s.id} survived into combat`);
      }
    });
    return res;
  });
  let expectUnite = null;
  // the 联防 decision (both combat modes): made after the COMBAT_END pause from the players still in
  wrap(m, '_afterCombat', function (orig) {
    if (m.phase === PHASE.COMBAT) check('unite trigger', () => {
      const counted = (pid) => ((m.lastResults.get(pid) || {}).leaked || []).filter((l) => l && l.counted !== false).length;
      const alive = m.alivePlayers();
      const leak = alive.some((p) => counted(p.playerId) > 0);
      const perfect = alive.some((p) => counted(p.playerId) === 0);
      expectUnite = { round: m.round, expect: !m.isSolo && leak && perfect };
    });
    return orig();
  });
  wrap(m, 'startUnite', function (orig, plan) {
    check('unite plan', () => {
      const res = m.lastResults;
      const counted = (pid) => ((res.get(pid) || {}).leaked || []).filter((l) => l && l.counted !== false).length;
      const alive = m.alivePlayers();
      const leakers = alive.filter((p) => counted(p.playerId) > 0).map((p) => p.playerId).sort();
      const perfect = alive.filter((p) => counted(p.playerId) === 0);
      const helpers = helperOrder(m, perfect, res).map((p) => p.playerId);
      if (helpers.length > gd.unite.maxHelpers) fail(`${helpers.length} 联防 helpers (max ${gd.unite.maxHelpers})`);
      if (plan.helpers.some((p) => !p.alive || p.left)) fail(`联防 helper eliminated / departed: ${plan.helpers.filter((p) => !p.alive || p.left).map((p) => p.playerId)}`);
      if (m.isSolo) fail('联防 in solo');
      if (JSON.stringify(plan.leakers.map((p) => p.playerId).sort()) !== JSON.stringify(leakers)) fail(`联防 leakers ${plan.leakers.map((p) => p.playerId)} != ${leakers}`);
      if (JSON.stringify(plan.helpers.map((p) => p.playerId)) !== JSON.stringify(helpers)) fail(`联防 helpers ${plan.helpers.map((p) => p.playerId)} != ${helpers}`);
    });
    const r = orig(plan);
    runInvariants();
    return r;
  });
  wrap(m, 'settle', function (orig, plan, uniteResult) {
    check('unite trigger', () => {
      if (expectUnite && expectUnite.round === m.round && expectUnite.expect !== !!plan) fail(`联防 ${plan ? 'ran' : 'skipped'} but ${expectUnite.expect ? '≥ 1 leaker and ≥ 1 perfect player' : 'not both a leaker and a perfect player'}`);
      expectUnite = null;
    });
    const before = new Map(m.alivePlayers().map((ps) => [ps, ps.lp]));
    const res = orig(plan, uniteResult);
    check('settle', () => {
      const cap = gd.lpCapPerRound;
      const uniteRan = !!(plan && uniteResult && !uniteResult.synthetic);
      for (const [ps, lp0] of before) {
        const r = m.lastResults.get(ps.playerId) || { leaked: [] };
        const counted = (r.leaked || []).filter((l) => l && l.counted !== false).length;
        // after 联防 a leaker pays for every surviving enemy of its source — enemies spawned by its leaked enemies
        // (splitters, summoners) included — so only the cap bounds it; everybody else never exceeds own leaks
        const max = uniteRan && plan.leakers.includes(ps) ? cap : Math.min(cap, counted);
        if (ps.alive) {
          const loss = lp0 - ps.lp;
          if (loss < 0) fail(`${ps.playerId}: LP rose in settle ${lp0} → ${ps.lp}`);
          if (loss > max) fail(`${ps.playerId}: lost ${loss} LP with ${counted} counted leaks (cap ${cap})`);
          if (!uniteRan && loss !== max) fail(`${ps.playerId}: lost ${loss} LP, expected min(${cap}, ${counted})`);
          if (ps.lp <= 0) fail(`${ps.playerId}: alive with LP ${ps.lp}`);
        } else {
          // eliminated: LP is clamped to 0, so the loss was ≥ lp0 and still ≤ min(cap, counted)
          if (lp0 > max) fail(`${ps.playerId}: eliminated from ${lp0} LP with only ${counted} counted leaks`);
          if (ps.eliminatedRound !== m.round) fail(`${ps.playerId}: eliminated round ${ps.eliminatedRound} != ${m.round}`);
          if (ps.lp !== 0) fail(`${ps.playerId}: eliminated with LP ${ps.lp}`);
        }
      }
      expectDeadline(3, 'SETTLE', { silentSolo: true });
    });
    runInvariants();
    return res;
  });
  wrap(m, 'startFinalAssault', function (orig, hidden) {
    const alive = m.alivePlayers();
    const lpSum = alive.reduce((s, p) => s + Math.max(0, p.lp), 0);
    const teamLp0 = m.teamLp;
    const res = orig(hidden);
    runInvariants();
    check('final assault', () => {
      if (!alive.length) return;
      const groups = pairPlayers(alive).map((g) => g.map((p) => p.playerId).join(','));
      const fields = m.fields.map((f) => f.players.join(','));
      if (JSON.stringify(groups) !== JSON.stringify(fields)) fail(`boss fields ${fields.join(' | ')} != seat pairs ${groups.join(' | ')}`);
      m.fields.forEach((f, i) => { if (f.fieldId !== `b${i + 1}`) fail(`boss field id ${f.fieldId}`); });
      if (!hidden && m.teamLp !== lpSum) fail(`team LP ${m.teamLp} != Σ alive LP ${lpSum}`);
      if (hidden && m.teamLp !== teamLp0) fail(`hidden core changed team LP ${teamLp0} → ${m.teamLp}`);
      const want = bossPoolHp(gd, hidden ? m.hiddenBossId : m.bossId, alive.length);
      if (!m.bossPool || m.bossPool.maxHp !== want) fail(`boss pool ${m.bossPool && m.bossPool.maxHp} != ${want}`);
      if (hidden && !hiddenEligible(gd, { layerSum: m.hiddenLayerSum, teamLp: m.teamLp })) fail('hidden core entered while not eligible');
      if (hidden && gd.difficulty === 'FUNNY') fail('hidden core on FUNNY');
    });
    return res;
  });
  wrap(m, 'finish', function (orig, outcome) {
    const res = orig(outcome);
    check('result', () => {
      const r = m.lastResultMsg;
      if (!r) { fail('no m.result'); return; }
      const titles = r.players.map((p) => p.title && p.title.id).filter(Boolean);
      if (new Set(titles).size !== titles.length) fail(`a title was given twice: ${titles}`);
      const cfg = Array.isArray(gd.config.titles) ? gd.config.titles : [];
      for (const p of r.players) {
        const t = p.title && cfg.find((x) => x.id === p.title.id);
        if (t && t.onlyOnWin && !r.victory) fail(`${p.playerId}: win-only title ${t.id} on a defeat`);
        const ps = m.players.get(p.playerId);
        const want = !ps.alive && ps.eliminatedRound != null ? Math.max(0, ps.eliminatedRound - 1) : r.victory ? gd.bossRound + (r.hiddenCleared ? 1 : 0) : Math.max(0, Math.min(m.round, gd.bossRound) - 1);
        if (p.roundsPassed !== want) fail(`${p.playerId}: roundsPassed ${p.roundsPassed}, expected ${want}`);
      }
      if (r.hiddenReached && !m.hiddenReached) fail('hiddenReached mismatch');
      // after the Final Assault the alive players' LP are their shares of the merged team pool
      if (r.teamLp != null && m.alivePlayers().some((p) => p.lpAtFinal != null)) {
        const sum = r.players.filter((p) => p.alive).reduce((s, p) => s + p.lp, 0);
        if (sum !== r.teamLp) fail(`Σ alive result LP ${sum} != team LP ${r.teamLp}`);
      }
    });
    return res;
  });
  return audit;
}

/** Content that may pay out or refund around a purchase (then exact price checks are skipped). */
function hasSpendEffects(m, ps) {
  const reg = m.registry;
  const keys = ['onBuy', 'onSpend', 'onSold', 'onRefresh', 'onLevelUp', 'onGain', 'onLayers'];
  const any = (h) => h && keys.some((k) => typeof h[k] === 'function');
  if (reg.globals().some(([, h]) => any(h))) return true;
  if (ps.bandId && any(reg.get(`band:${ps.bandId}`))) return true;
  for (const id of m.gd.bondIds) if (any(reg.get(`bond:${id}`))) return true;
  for (const e of ps.effects) if (e && typeof e.key === 'string' && any(reg.get(e.key))) return true;
  for (const p of ps.allChess()) {
    const rec = m.gd.chess(p.id);
    for (const gid of (rec && rec.garrisonIds) || []) { const g = m.gd.garrison(gid); if (g && reg.get(`garrison:${g.effectKey}`)) return true; }
    for (const it of p.items || []) if (any(reg.get(`item:${String(it.id).replace(/_[ab]$/, '')}`))) return true;
  }
  return false;
}
