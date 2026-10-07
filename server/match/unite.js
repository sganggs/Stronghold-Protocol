// server/match/unite.js — 联防 (Unite) planning and LP attribution (DESIGN §6.1, research 06 §5, research 08 §5).
//
// Trigger (co-op only): after the normal combats, ≥ 1 alive player leaked (a counted leak ⇒ not perfect) and
// ≥ 1 alive player was perfect. Helpers (PRTS 卫戍协议/帮助 §联防阶段): up to config.unite.maxHelpers (2) perfect
// players chosen by most units on the field (downed included) > has an active bond (存疑) > most undowned units, then
// seat; with 2 helpers the one ranked first by most units > active bond > Σ active bond layers (存疑) > most undowned
// units "率先迎敌" on the RIGHT-hand field (colOffset +8, where the escaped_multi routes enter), the other keeps the
// left half (colOffset 0); a lone helper plays escaped_single on its own field. The field is the ROUND'S OWN battlefield
// — its left half is one helper's field, its right half (the one whose gates the escaped_multi routes enter from) the
// other's — so its water, crates, devices and special tiles are all there; every helper's pieces on their prep tiles
// ("按休整期位置部署在场"), the right-hand one shifted 8 columns
// (the official maps' halves, = the stage config's player_map_lr_offset 8). 0.1.4 built the field on the 联防 template
// level's own map instead (GitHub #41: data/stages.json act1autochess_escaped_single / _multi, one bare road — every
// obstacle and special tile was gone, user report), so the round's battlefield is back; only the routes below come from
// the escaped template. Their operators keep the HP ratio and the SP (技力, stored charges included) from the end of
// their own combat, nothing else — a skill still running then
// enters switched off (BattleResult.unitsEnd → PlayerBattleInput.units[].carryState `{ hpPct, sp }`, "阵地以其当前状态";
// community report #34 / GitHub #82: it used to restart for free). An operator knocked out at the end of its own combat (alive false) is fielded with
// `carryState: { down: true }`: PRTS "部署完成后，将对应单位的生命比例、技力修改至与上一阶段结束时相同（召唤物仅修改技力，
// 上一阶段为退场状态的干员强制退场）" — the sim deploys it with everyone and forces it out at once (constants.js
// FORCED_EXIT), so it lies on its own tile with the redeploy ring and comes back like after any knock-out (user
// playtest #5 item 2: it used to be left out and vanished). Its timer is its full redeploy time (the official 联防
// setup carries only hp / tech per operator, research 09 §3 HelpBattleInfo; the user confirmed it restarts). The board's summon
// pieces are fielded as the board has them and keep only their SP ("召唤物仅修改技力": carryState `{ sp }`, unitsEnd lists
// them beside the operators; one off the field at the end enters fresh [ASSUMED]). Enemies = the union of every leaker's
// counted leaks (same stats: the SpawnSpec mods travel with the leak), routed on the escaped template (`escaped_single`
// for 1 helper, `escaped_multi` for 2): walkers on its `lrsldr` action, flyers on `yokai`, tokens on `gopro_2` /
// `lazerd` (waves.js buildUniteWave); kill bounties keep paying the killer (a helper) — a death no operator caused pays
// the helper whose half it fell on (Battle._bountyPayee). No IN_BATTLE layer gains ("该阶段不能叠加层数"); the helpers'
// bonds carry the layers their own combat reached (PlayerState.battleInput `reached`: the round's pending gains, capped
// like settle() — the strip's count; "以其阵地当前的状态" [ASSUMED] includes them; until 0.1.3 the round-start layers),
// and settle() still adds those gains once. Time limit = the round's combat limit.
// LP: an enemy still alive at the end (leaked in the unite battle, or never spawned before the limit) costs its
// SOURCE player 1 LP; each player's round loss = min(lpCap, survivors attributed to them + leaks that could not
// re-enter) — the same 10 cap as a normal round.

import { buildUniteWave } from './waves.js';
import { layerGainRoom } from '../../shared/constants.js';

/**
 * @param {import('./Match.js').Match} m
 * @param {Map<string, object>} results playerId → BattleResult.perPlayer entry of the player's own combat
 * @returns {null | { helpers: any[], leakers: any[], leaked: object[], notReentered: Map<string, number> }}
 */
export function planUnite(m, results) {
  if (m.isSolo) return null;
  const alive = m.alivePlayers();
  const leakers = [];
  const perfects = [];
  for (const ps of alive) {
    const r = results.get(ps.playerId);
    if (!r) continue;
    const counted = (r.leaked || []).filter((l) => l && l.counted !== false);
    if (counted.length > 0) leakers.push(ps);
    else if (r.perfect !== false) perfects.push(ps);
  }
  if (!leakers.length || !perfects.length) return null;
  const helpers = helperOrder(m, perfects, results);
  const leaked = [];
  const notReentered = new Map();
  for (const ps of leakers) {
    const r = results.get(ps.playerId);
    for (const l of r.leaked || []) {
      if (!l || l.counted === false) continue;
      if (!m.gd.enemy(l.enemyKey)) { notReentered.set(ps.playerId, (notReentered.get(ps.playerId) || 0) + 1); continue; }
      // kill bounties keep paying in 联防, and only on the card's own enemy. A split or summoned child
      // never carries bountyId / bountyCoins (spawnChildren). A leak that still has the card's id but is
      // some other enemy — a copy that did not go through spawnChildren — does not collect the card either
      // (GitHub #67, #89-2; owner 2026-10-04: the main body only). A bounty set on the SpawnSpec by content
      // is copied into mods.bountyCoins by the match and has no card to match.
      const bountyId = l.mods && l.mods.bountyId;
      const b = bountyId ? ps.bounties.find((x) => x.id === bountyId) : null;
      const card = b && b.card;
      let bounty = card && card.payout !== 'perfect' && Number(card.coin) > 0 && l.enemyKey === card.enemyKey
        ? { coins: Math.trunc(card.coin), ownerPlayerId: ps.playerId } : null;
      const extra = !bountyId && l.mods ? Math.trunc(Number(l.mods.bountyCoins) || 0) : 0;
      if (!bounty && extra > 0) bounty = { coins: extra, ownerPlayerId: ps.playerId };
      leaked.push({ enemyKey: l.enemyKey, mods: l.mods ? { ...l.mods } : null, lpr: l.lpr ?? 1, sourcePlayerId: ps.playerId, tag: l.tag ?? null, bounty });
    }
  }
  return { helpers, leakers, leaked, notReentered };
}

/**
 * Helper metrics of a perfect player: units on the field (board operators, downed included), whether a bond is
 * active, Σ layers of the active bonds as the 联防 battle will fight them (the persistent layers plus this round's
 * pending gains, capped like bondsView / settle — PRTS 以其阵地当前的状态; the official "层数最高" tie-break is marked 存疑),
 * operators still standing at the end of the player's own combat.
 */
export function helperStats(m, ps, results) {
  const units = ps.deployCount;
  let active = false;
  let layers = 0;
  const pending = ps.pendingLayerGains;
  for (const [id, b] of Object.entries(ps.bonds || {})) {
    if (!b || !b.active) continue;
    active = true;
    const stored = Number(ps.layers && ps.layers[id]) || Number(b.layers) || 0;
    const gain = pending && Number(pending[id]);
    const add = Number.isFinite(gain) && gain > 0 ? layerGainRoom(stored, Math.floor(gain)) : 0;
    layers += stored + add;
  }
  const r = results && typeof results.get === 'function' ? results.get(ps.playerId) : null;
  const opUids = new Set();
  for (const p of ps.board.values()) if (p && p.kind === 'chess') opUids.add(p.uid);
  let standing = units;
  if (r && Array.isArray(r.unitsEnd) && r.unitsEnd.length) {
    standing = 0;
    for (const u of r.unitsEnd) if (u && opUids.has(u.uid) && u.alive) standing++;
  }
  return { units, active, layers, standing };
}

/**
 * The ≤ maxHelpers helpers, first = the one that meets the enemies first (right-hand field): selection by units >
 * active bond > standing units > seat, then the pair ordered by units > active bond > layers > standing > seat.
 */
export function helperOrder(m, perfects, results) {
  const st = new Map(perfects.map((ps) => [ps.playerId, helperStats(m, ps, results)]));
  const S = (ps) => st.get(ps.playerId);
  const select = perfects.slice().sort((a, b) => S(b).units - S(a).units || (S(b).active - S(a).active) || S(b).standing - S(a).standing || a.seat - b.seat)
    .slice(0, m.gd.unite.maxHelpers);
  return select.sort((a, b) => S(b).units - S(a).units || (S(b).active - S(a).active) || S(b).layers - S(a).layers || S(b).standing - S(a).standing || a.seat - b.seat);
}

/** Battle options for the unite field (without data/logger, added by the match). */
export function uniteBattleOpts(m, plan, timeLimit) {
  const wave = buildUniteWave(m.gd, plan.leaked, plan.helpers.length, timeLimit);
  const players = plan.helpers.map((ps, i) => {
    const carry = new Map();
    const r = m.lastResults.get(ps.playerId);
    const summonUids = new Set();
    for (const p of ps.board.values()) if (p && p.kind === 'token') summonUids.add(p.uid);
    for (const u of (r && r.unitsEnd) || []) {
      if (!u || u.uid == null) continue;
      const sp = Number.isFinite(u.sp) ? Math.max(0, u.sp) : 0;
      // a summon: its SP only ("召唤物仅修改技力"); one off the field at the end enters fresh [ASSUMED]
      if (summonUids.has(u.uid)) { if (u.alive) carry.set(u.uid, { sp }); continue; }
      // knocked out at the end of its own combat: 强制退场 right after the deployment (see header)
      if (!u.alive) { carry.set(u.uid, { down: true }); continue; }
      // HP ratio and SP only: a skill still running at the end is not carried (unitsEnd `skillActive` stays unused —
      // community report #34, GitHub #82)
      carry.set(u.uid, { hpPct: Number.isFinite(u.hpPct) ? Math.max(0.01, Math.min(1, u.hpPct)) : 1, sp });
    }
    // 2 helpers: the first one meets the enemies first on the right-hand field (escaped_multi enters at col 18)
    const colOffset = plan.helpers.length > 1 && i === 0 ? 8 : 0;
    // the layers its own combat reached (bondsView, the round's pending gains; PRTS "以其阵地当前的状态") — see header
    const input = ps.battleInput({ side: 'L', colOffset, carry, reached: true });
    const ev = { input, kind: 'unite', round: m.round, spawns: wave.spawns };
    m.dispatch(ps, 'onBattleStart', ev);
    return ev.input && typeof ev.input === 'object' ? ev.input : input;
  });
  return { wave, players };
}

/**
 * LP loss per leaker after the unite battle: survivors by source (+ unspawned re-entries + not re-entered leaks),
 * capped per round.
 * @returns {Map<string, number>} playerId → survivors (uncapped)
 */
export function uniteSurvivors(plan, uniteResult) {
  const out = new Map();
  for (const [pid, n] of plan.notReentered) out.set(pid, (out.get(pid) || 0) + n);
  const perPlayer = (uniteResult && uniteResult.perPlayer) || {};
  for (const pp of Object.values(perPlayer)) {
    for (const l of (pp && pp.leaked) || []) {
      if (!l || l.counted === false || !l.sourcePlayerId) continue;
      out.set(l.sourcePlayerId, (out.get(l.sourcePlayerId) || 0) + 1);
    }
  }
  for (const u of (uniteResult && uniteResult.unspawned) || []) {
    if (!u || !u.sourcePlayerId) continue;
    out.set(u.sourcePlayerId, (out.get(u.sourcePlayerId) || 0) + 1);
  }
  return out;
}
