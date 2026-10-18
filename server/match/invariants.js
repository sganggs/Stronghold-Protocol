// server/match/invariants.js — engine invariants (DESIGN §11) as a non-throwing check. Used by the test harness
// (i18n-ignore-file: developer reports in English with the game's terms, never shown to players — docs/I18N.md)
// (test/match/harness.js checkInvariants asserts the list is empty) and by tools/matchrun.mjs --check sweeps.
//
// collectViolations(m) → string[] (empty when every invariant holds):
//   pool     raw balance ≤ cap and raw balance + Σ copies held by pieces == cap (public availability is clamped at zero) per base chess; non-pool chess hold 0 copies;
//            every capped shop item is held by at most its cap (normal occupies 1, upgraded 2; effect-only items have no cap)
//            a player's 自选 stock (0.2.0, player/diy.js) the same against its own pieces of each slotted slot — a DIY
//            piece is always a slotted slot of its owner's, and a DIY shop / reward card one of its stocked slots
//   economy  funds / pendingFunds non-negative integers, LP finite, shop level in range, prices ≥ 0
//   pieces   unique uids; hand 10 / temp 5 slots; temp holds pieces only while the hand is full (a free hand slot pulls
//            a temp piece in, PlayerState._fillHandFromTemp); chess carry ≤ equipPerChess known items
//            (morphPairing plus: a 变形同构体 does not count toward that cap); a normal piece
//            holds ≤ 1 copy, an elite ≤ goldenCopies; merges are immediate (never `mergeCount` normal copies of one
//            chess, never two copies of a mergeable normal item); every token's owner chess is deployed
//   board    tiles inside the own region and legal for the piece (a range-bound summon inside its owner's attack
//            range); no items on the board; chess count ≤ deploy cap
//            (where a merge's elite goes — a consumed deployed copy's tile, else the hand — needs the state before the
//            merge: audit.js checks it per merge)
//   bonds    ps.bonds equals a fresh computeBonds() (every mutation recomputed them); every bond's layers 0 … BOND_LAYER_CAP
//   shop     slot count follows the rolled layout; ids known; banned chess never offered by the shop / rewards
//   elim.    an eliminated player owns nothing (board, hand, temp, shop, offers, bounties, funds)
//   choice   a player's open 教鞭 choice (`personalChoice`) is one of an alive, not-Ready player in the PREP of its own round,
//            with one to three different cards
//   match    phase known; teamLp / boss pool within range; combat fields match the alive players

import { PHASE, BOND_LAYER_CAP } from '../../shared/constants.js';
import { morphSlotPolicy, ruleOption } from '../../shared/plugins/rules.js';
import { FIELD, canPlace, placeClass, positionClass, parseKey } from './board.js';
import { computeBonds } from './bondsMeta.js';

const PHASES = new Set(Object.values(PHASE));

/**
 * @param {import('./Match.js').Match} m
 * @param {{ limit?: number }} [opts]
 * @returns {string[]}
 */
export function collectViolations(m, { limit = 25 } = {}) {
  const out = [];
  const fail = (msg) => { if (out.length < limit) out.push(msg); };
  const gd = m.gd;
  const held = new Map();
  const uids = new Set();
  const banned = new Set(m.bannedChess || []);
  const note = (ps, p) => {
    if (!Number.isInteger(p.uid) || p.uid <= 0) fail(`${ps.playerId}: bad uid ${p.uid}`);
    else if (uids.has(p.uid)) fail(`${ps.playerId}: duplicate uid ${p.uid}`);
    uids.add(p.uid);
  };

  if (!PHASES.has(m.phase)) fail(`unknown phase ${m.phase}`);
  if (m.teamLp != null && !(Number.isFinite(m.teamLp) && m.teamLp >= 0)) fail(`teamLp ${m.teamLp}`);
  if (m.bossPool && !(m.bossPool.hp >= 0 && m.bossPool.hp <= m.bossPool.maxHp)) fail(`boss pool ${m.bossPool.hp}/${m.bossPool.maxHp}`);

  for (const ps of m.players.values()) {
    const id = ps.playerId;
    // the player's view of the data (its slotted 自选 slots are its operators) and the copies its 自选 pieces hold
    const pgd = ps.gd || gd;
    const diyHeld = new Map();
    if (!Number.isInteger(ps.funds) || ps.funds < 0) fail(`${id}: funds ${ps.funds}`);
    if (!Number.isInteger(ps.pendingFunds) || ps.pendingFunds < 0) fail(`${id}: pendingFunds ${ps.pendingFunds}`);
    if (!Number.isFinite(ps.lp)) fail(`${id}: lp ${ps.lp}`);
    if (ps.alive && m.phase !== PHASE.SETTLE && ps.lp <= 0 && m.teamLp == null && m.round > 0 && ps.bandId) fail(`${id}: alive with lp ${ps.lp}`);
    if (ps.hand.length !== gd.benchSize) fail(`${id}: hand has ${ps.hand.length} slots`);
    if (ps.temp.length < gd.tempSize) fail(`${id}: temp has fewer than ${gd.tempSize} visible slots`);
    if (ps.temp.length > gd.tempSize && ps.temp.some((x) => x == null)) fail(`${id}: overflow queue has an unfilled slot`);
    // 临时整备区 = overflow only (PRTS 卫戍协议/帮助 §手牌区 "常规手牌区出现空位时自动移入", GitHub #82)
    if (ps.temp.some(Boolean) && ps.hand.some((x) => x == null)) fail(`${id}: a temp piece waits while a hand slot is free`);
    if (!(ps.shop.level >= 1 && ps.shop.level <= gd.maxShopLevel)) fail(`${id}: shop level ${ps.shop.level}`);
    if (!(ps.shop.upgradePrice >= 0)) fail(`${id}: upgradePrice ${ps.shop.upgradePrice}`);
    if (!Number.isInteger(ps.shop.freeRefreshes) || ps.shop.freeRefreshes < 0) fail(`${id}: freeRefreshes ${ps.shop.freeRefreshes}`);
    // the official per-bond layer cap (shared/constants.js): no writer may pass it
    for (const [b, v] of Object.entries(ps.layers || {})) {
      if (!(Number.isFinite(v) && v >= 0 && (!(BOND_LAYER_CAP > 0) || v <= BOND_LAYER_CAP))) fail(`${id}: ${b} layers ${v}`);
    }

    if (!ps.alive) {
      if (ps.board.size) fail(`${id}: eliminated but keeps ${ps.board.size} board pieces`);
      if (ps.hand.some(Boolean) || ps.temp.some(Boolean)) fail(`${id}: eliminated but keeps hand/temp pieces`);
      if (ps.shop.slots.length || ps.offers.length || ps.bounties.length) fail(`${id}: eliminated but keeps shop/offers/bounties`);
      if (ps.funds || ps.pendingFunds) fail(`${id}: eliminated with funds ${ps.funds}+${ps.pendingFunds}`);
    }
    // 教鞭's personal choice (Match.offerBountyChoice): resolved before the prep ends — by its owner, the deadline or the bot
    const pc = ps.personalChoice;
    if (pc) {
      if (!ps.alive || ps.ready || m.phase !== PHASE.PREP || pc.round !== m.round) fail(`${id}: a personal choice outside its own prep (${m.phase} R${m.round}, offered in R${pc.round})`);
      if (!Array.isArray(pc.cards) || !pc.cards.length || pc.cards.length > 3 || new Set(pc.cards.map((c) => c && c.effectId)).size !== pc.cards.length) fail(`${id}: personal choice of ${pc.cards && pc.cards.length} cards`);
    }

    // pieces
    const all = [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)];
    const boardChessUids = new Set();
    for (const p of ps.board.values()) if (p.kind === 'chess') boardChessUids.add(p.uid);
    const itemCounts = new Map();
    // A copy gained as the previous prep ended (PlayerState.acquireItem deferMerge) waits until the next prep.
    // It does not count toward "merges are immediate" until that prep's checkItemMerges consumes it.
    const countItem = (it) => { if (it.deferMerge) return; itemCounts.set(it.id, (itemCounts.get(it.id) || 0) + 1); };
    for (const p of all) {
      note(ps, p);
      if (p.kind === 'chess') {
        const rec = pgd.chess(p.id);
        if (!rec) { fail(`${id}: unknown chess ${p.id}`); continue; }
        if (rec.isDiy && !rec.diyFor) fail(`${id}: owns ${p.id}, a 自选 slot it has not filled`);
        const slots = morphSlotPolicy(ruleOption(m.rules, 'morphPairing'), (it) => !!pgd.item(it?.id)?.canGiveBond);
        if (!Array.isArray(p.items) || slots.slotsUsed(p.items) > slots.slotCap(gd.equipPerChess)) fail(`${id}: ${p.id} carries ${p.items && p.items.length} items`);
        if (ruleOption(m.rules, 'morphPairing') === 'plus' && (p.items || []).filter((it) => pgd.item(it?.id)?.canGiveBond).length > 1) fail(`${id}: ${p.id} carries multiple morphs`);
        for (const it of p.items || []) {
          note(ps, it);
          if (it.kind !== 'item' || !gd.item(it.id)) fail(`${id}: ${p.id} carries a bad item ${it.kind}:${it.id}`);
          else if (gd.item(it.id).itemType !== 'EQUIP') fail(`${id}: ${p.id} carries a non-equipment item ${it.id}`);
          countItem(it);
        }
        const maxCopies = rec.isGolden ? gd.goldenCopies : 1;
        if (!Number.isInteger(p.poolCopies) || p.poolCopies < 0 || p.poolCopies > maxCopies) fail(`${id}: ${p.id} holds ${p.poolCopies} copies`);
        const base = gd.baseIdOf(p.id);
        const tally = rec.isDiy ? diyHeld : held;
        tally.set(base, (tally.get(base) || 0) + (p.poolCopies || 0));
      } else if (p.kind === 'item') {
        if (!gd.item(p.id)) fail(`${id}: unknown item ${p.id}`);
        countItem(p);
      } else if (p.kind === 'token') {
        if (!pgd.token(p.id)) fail(`${id}: unknown token ${p.id}`);
        if (!(p.count >= 1)) fail(`${id}: token stack count ${p.count}`);
        // summons exist only while their owner is deployed (withdrawing / selling / merging it removes them)
        if (!boardChessUids.has(p.ownerUid)) fail(`${id}: token ${p.uid} without a deployed owner (${p.ownerUid})`);
      } else {
        fail(`${id}: piece of unknown kind ${p.kind}`);
      }
    }
    // board
    let deployed = 0;
    // a pure read (Match.deployMapFor: the field the player deploys on now) — PlayerState.deployMap() would update the
    // player's cached field / legality flag, and this checker must not change when a later recompute moves pieces
    const dmap = typeof m.deployMapFor === 'function' ? m.deployMapFor(ps) : ps.deployMap();
    for (const [k, p] of ps.board) {
      const [r, c] = parseKey(k);
      if (!(r >= FIELD.r0 && r <= FIELD.r1 && c >= FIELD.c0 && c <= FIELD.c1)) fail(`${id}: piece outside the board at ${k}`);
      if (p.kind === 'item') { fail(`${id}: item ${p.id} stands on the board`); continue; }
      const rec = p.kind === 'token' ? pgd.token(p.id) : pgd.chess(p.id);
      const cls = p.kind === 'chess' ? placeClass(ps, rec) : positionClass(rec);
      if (rec && !canPlace(dmap, cls, r, c)) fail(`${id}: ${p.id} on an illegal tile ${k}`);
      // a "只能部署在召唤者攻击范围内" summon inside its owner's attack range (PlayerState.summonRange: a pure read)
      const range = p.kind === 'token' && typeof ps.summonRange === 'function' ? ps.summonRange(p) : null;
      if (range && !range.has(k)) fail(`${id}: ${p.id} on ${k}, outside its owner's attack range`);
      // an outside-bound summon (战术锚点, PlayerState.summonExcluded) outside it
      const out = p.kind === 'token' && typeof ps.summonExcluded === 'function' ? ps.summonExcluded(p) : null;
      if (out && out.has(k)) fail(`${id}: ${p.id} on ${k}, inside its owner's attack range`);
      if (p.kind === 'chess') deployed++;
    }
    if (deployed > ps.deployCap) fail(`${id}: ${deployed} chess deployed > cap ${ps.deployCap}`);
    // merges are immediate
    const copies = new Map();
    for (const p of all) if (p.kind === 'chess' && pgd.chess(p.id) && !gd.isGolden(p.id)) { const b = gd.baseIdOf(p.id); copies.set(b, (copies.get(b) || 0) + 1); }
    for (const [b, n] of copies) {
      const need = gd.mergeCount(b);
      if (need > 1 && gd.goldenIdOf(b) && n >= need) fail(`${id}: owns ${n} normal copies of ${b} (merges at ${need})`);
    }
    for (const [itemId, n] of itemCounts) {
      const rec = gd.item(itemId);
      if (!rec || rec.isGolden || rec.itemType !== 'EQUIP' || !rec.mergeable) continue;
      const need = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : gd.itemMergeCount;
      const gid = rec.upgradeChessId || rec.goldenId;
      if (need > 1 && need < 100 && gid && gd.item(gid) && n >= need) fail(`${id}: owns ${n} copies of item ${itemId} (merges at ${need})`);
    }
    // bonds are up to date
    try {
      const fresh = computeBonds(pgd, ps);
      if (JSON.stringify(fresh) !== JSON.stringify(ps.bonds)) fail(`${id}: stale bonds (missing recompute)`);
    } catch (e) {
      fail(`${id}: computeBonds threw ${e && e.message}`);
    }
    // shop
    if (ps.alive) {
      const layout = ps.shop.layout;
      if (layout && ps.shop.slots.length !== layout.chess + layout.item) fail(`${id}: ${ps.shop.slots.length} shop slots for layout ${layout.chess}+${layout.item}`);
      ps.shop.slots.forEach((s, i) => {
        if (!s) return;
        if (s.kind === 'chess' ? !gd.chess(s.id) : !gd.item(s.id)) fail(`${id}: shop slot ${i} unknown ${s.kind} ${s.id}`);
        if (!Number.isInteger(s.basePrice) || s.basePrice < 0) fail(`${id}: shop slot ${i} basePrice ${s.basePrice}`);
        if (s.kind === 'chess' && banned.has(gd.baseIdOf(s.id))) fail(`${id}: banned chess ${s.id} in the shop`);
        if (s.kind === 'chess' && gd.chess(s.id)?.isDiy && !(ps.diyStock && ps.diyStock.has(gd.baseIdOf(s.id)))) fail(`${id}: 自选 slot ${s.id} in the shop without its stock`);
      });
      for (const o of ps.offers) {
        for (const s of o.slots || []) {
          if (s.kind === 'item' ? !gd.item(s.id) : !gd.chess(s.id)) fail(`${id}: bad reward slot ${s.kind} ${s.id}`);
          if (s.kind !== 'item' && banned.has(gd.baseIdOf(s.id)) && o.source === 'merge') fail(`${id}: banned chess ${s.id} offered as a merge reward`);
          if (s.kind !== 'item' && gd.chess(s.id)?.isDiy && !(ps.diyStock && ps.diyStock.has(gd.baseIdOf(s.id)))) fail(`${id}: 自选 slot ${s.id} offered without its stock`);
        }
        if (!o.slots || !o.slots.length || o.slots.length > 6) fail(`${id}: reward offer with ${o.slots && o.slots.length} slots`);
      }
    }
    // 自选 stock accounting (player/diy.js): left + held == cap per slotted slot; a slot without stock holds nothing
    for (const [base, e] of ps.diyStock ? ps.diyStock.entries : []) {
      if (!(Number.isInteger(e.left) && e.left <= e.cap)) fail(`${id}: 自选 stock ${base}: balance ${e.left} cap ${e.cap}`);
      const h = diyHeld.get(base) || 0;
      if (e.left + h !== e.cap) fail(`${id}: 自选 stock ${base}: left ${e.left} + held ${h} != cap ${e.cap}`);
    }
    for (const [base, n] of diyHeld) if (!(ps.diyStock && ps.diyStock.has(base)) && n !== 0) fail(`${id}: 自选 slot ${base} without stock holds ${n} copies`);
  }

  // shared pool accounting
  for (const [base, e] of m.pool.entries) {
    if (!(Number.isInteger(e.left) && e.left <= e.cap)) fail(`pool ${base}: balance ${e.left} cap ${e.cap}`);
    const h = held.get(base) || 0;
    if (e.left + h !== e.cap) fail(`pool ${base}: left ${e.left} + held ${h} != cap ${e.cap}`);
  }
  for (const [base, n] of held) if (!m.pool.has(base) && n !== 0) fail(`non-pool chess ${base} holds ${n} copies`);

  // Displayed shop cards and item rewards may overdraw; itemPool.debt is that overage (#624). Fixed gift families
  // may overdraw without a debt entry. debt > over is always a missed repay or a debt recorded for a piece not kept.
  // The chess pool above also permits explicit overdraw (Mimic, displayed operator cards).
  if (m.itemPool && gd.raw.items) {
    for (const [id, rec] of Object.entries(gd.raw.items)) {
      if (!rec || rec.isGolden) continue;
      const cap = m.itemPool.cap(id);
      if (!Number.isInteger(cap)) continue;
      const h = m.itemPool.held(id);
      const over = Math.max(0, h - cap);
      const debt = m.itemPool.debtOf(id);
      if (debt > over) fail(`item ${id}: debt ${debt} > overage ${over} (held ${h}, cap ${cap})`);
      if (!gd.isUnlimitedGiftItem(id) && over > debt) fail(`item ${id}: held ${h} > cap ${cap} without debt ${debt}`);
    }
  }

  // combat fields
  if (m.phase === PHASE.COMBAT) {
    // one field per alive player (+ the force-ended field of a player who quit during this combat)
    const alive = m.order.filter((p) => p.alive || (p.left && m.fields.some((f) => f.fieldId === `n:${p.playerId}`))).map((p) => `n:${p.playerId}`).sort();
    const ids = m.fields.map((f) => f.fieldId).sort();
    if (JSON.stringify(alive) !== JSON.stringify(ids)) fail(`combat fields ${ids.join(',')} != alive ${alive.join(',')}`);
  }
  return out;
}
