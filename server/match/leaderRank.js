// Per-operator tally of the CURRENT leader pool (规程 only). A breakdown of damage the server already credited:
// a client's rows cannot raise the pool or a player's bossBy. Server CreditPool excess is added on top and is not
// part of bossBy. [ASSUMED] the published share is damage / the pool's max HP (monotonic; a share of damage dealt
// so far can shrink). [ASSUMED] ties keep both operators: damage desc, then seat, then uid. Mis-attribution inside
// one player's credited total is the limit of the check — the boss path does not re-simulate who dealt it.

import { leaderOpsRows } from '../../shared/leaderOps.js';

const DUST = 1e-6;

/** @param {import('./gamedata.js').GameData|null|undefined} gd */
export function regulationLeaderRank(gd) {
  return gd?.config?.version?.family === 'regulation';
}

/** @param {unknown} ops @returns {Array<{ uid: number, pid: string, chess: string, tier: number, dmg: number }>} */
export function cleanLeaderOps(ops) {
  return leaderOpsRows(ops) || [];
}

function rowKey(pid, uid) {
  return `${pid}\0${uid}`;
}

/**
 * One field's latest rows, scaled so each player's units sum to the damage that player was already credited
 * (`capOf` = f.bossBy). Players off the field are ignored. A repeated uid keeps the larger report. When the
 * sum exceeds the cap, the rows scale down and the last uid (uid order) absorbs the float dust.
 * @param {Array<{ uid: number, pid: string, chess: string, tier: number, dmg: number }>} ops
 * @param {string[]} players
 * @param {(pid: string) => number} capOf
 */
export function clientPartsForField(ops, players, capOf) {
  const allowed = new Set(players);
  /** @type {Map<string, { pid: string, uid: number, chess: string, tier: number, dmg: number }>} */
  const best = new Map();
  for (const row of ops || []) {
    if (!row || !allowed.has(row.pid)) continue;
    const key = rowKey(row.pid, row.uid);
    const prev = best.get(key);
    if (!prev || row.dmg > prev.dmg) best.set(key, { pid: row.pid, uid: row.uid, chess: row.chess, tier: row.tier, dmg: row.dmg });
  }
  /** @type {Map<string, Array<{ pid: string, uid: number, chess: string, tier: number, dmg: number }>>} */
  const byPid = new Map();
  for (const row of best.values()) {
    let list = byPid.get(row.pid);
    if (!list) { list = []; byPid.set(row.pid, list); }
    list.push(row);
  }
  const out = [];
  for (const [pid, list] of byPid) {
    list.sort((a, b) => a.uid - b.uid);
    const cap = Math.max(0, Number(capOf(pid)) || 0);
    let sum = 0;
    for (const r of list) sum += r.dmg;
    if (!(sum > DUST) || !(cap > DUST)) continue;
    if (sum <= cap) {
      for (const r of list) if (r.dmg > DUST) out.push({ pid: r.pid, uid: r.uid, chess: r.chess, tier: r.tier, dmg: r.dmg });
      continue;
    }
    let used = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const d = i === list.length - 1 ? Math.max(0, cap - used) : (r.dmg / sum) * cap;
      used += d;
      if (d > DUST) out.push({ pid: r.pid, uid: r.uid, chess: r.chess, tier: r.tier, dmg: d });
    }
  }
  return out;
}

function blankRow(hit) {
  const tier = Number.isInteger(hit.tier) ? Math.max(0, Math.min(10, hit.tier)) : 0;
  return { pid: hit.pid, uid: hit.uid, chess: hit.chess, tier, dmg: 0, client: new Map(), server: 0 };
}

/**
 * Replace this field's client parts, then add server-sim damage past the cursor. Idempotent: a second call
 * with the same report and the same battle adds nothing. A new battle object resets the cursor (a handover
 * re-sim starts its hits at the excess only; an old cursor would drop that excess).
 * @param {{ ops: Map<string, any>|null|undefined }} pool
 * @param {any} f
 */
export function syncFieldLeaderOps(pool, f) {
  if (!pool || !pool.ops || !f) return;
  const fieldId = f.fieldId;
  for (const row of pool.ops.values()) {
    const prev = row.client.get(fieldId) || 0;
    if (prev) {
      row.dmg -= prev;
      row.client.delete(fieldId);
    }
  }
  const report = Array.isArray(f.opsReport) ? f.opsReport : [];
  const parts = clientPartsForField(report, f.players || [], (pid) => (f.bossBy && f.bossBy[pid]) || 0);
  for (const part of parts) {
    const key = rowKey(part.pid, part.uid);
    let row = pool.ops.get(key);
    if (!row) {
      row = blankRow(part);
      pool.ops.set(key, row);
    }
    row.chess = part.chess;
    row.tier = part.tier;
    row.client.set(fieldId, part.dmg);
    row.dmg += part.dmg;
  }
  foldServerLeaderHits(pool, f);
  for (const [key, row] of pool.ops) {
    if (!(row.dmg > DUST) && !(row.server > DUST)) pool.ops.delete(key);
  }
}

/**
 * Damage the field's own battle recorded past the last fold. Client-authority fields are skipped: their
 * battle's hits are what `ops` already reported, and counting them again would double the acked portion.
 * @param {{ ops: Map<string, any> }} pool
 * @param {any} f
 */
export function foldServerLeaderHits(pool, f) {
  if (!pool || !pool.ops || !f || f.mode === 'client') return;
  const battle = f.battle;
  if (!battle || typeof battle.leaderHits !== 'function') return;
  const hits = battle.leaderHits();
  if (!Array.isArray(hits)) return;
  if (f._opsBattleRef !== battle) {
    f._opsBattleRef = battle;
    f._opsBattleSeen = new Map();
  }
  const seen = f._opsBattleSeen;
  const allowed = new Set(f.players || []);
  for (const hit of hits) {
    if (!hit || !allowed.has(hit.pid) || typeof hit.chess !== 'string' || !hit.chess) continue;
    const uid = hit.uid;
    const dmg = Number(hit.dmg);
    if (!Number.isInteger(uid) || !Number.isFinite(dmg) || !(dmg > 0)) continue;
    const key = rowKey(hit.pid, uid);
    const prev = seen.get(key) || 0;
    if (!(dmg > prev + DUST)) continue;
    const add = dmg - prev;
    seen.set(key, dmg);
    let row = pool.ops.get(key);
    if (!row) {
      row = blankRow({ pid: hit.pid, uid, chess: hit.chess, tier: hit.tier });
      pool.ops.set(key, row);
    } else {
      row.chess = hit.chess;
      if (Number.isInteger(hit.tier)) row.tier = Math.max(0, Math.min(10, hit.tier));
    }
    row.server += add;
    row.dmg += add;
  }
}

/**
 * Top 3 of the current pool. Order uses the float damage, then seat, then uid. The published `dmg` is rounded
 * and at least 1, so a hit smaller than half a point is not a 0% row. [ASSUMED] display rounding.
 * @param {{ ops: Map<string, any>|null|undefined }} pool
 * @param {(pid: string) => number} seatOf
 */
export function leaderTopRows(pool, seatOf) {
  if (!pool || !pool.ops) return [];
  const rows = [];
  for (const row of pool.ops.values()) if (row.dmg > DUST) rows.push(row);
  rows.sort((a, b) => {
    if (a.dmg !== b.dmg) return b.dmg - a.dmg;
    const sa = seatOf(a.pid);
    const sb = seatOf(b.pid);
    if (sa !== sb) return sa - sb;
    return a.uid - b.uid;
  });
  const top = rows.length > 3 ? rows.slice(0, 3) : rows;
  return top.map((r) => ({
    pid: r.pid,
    uid: r.uid,
    chess: r.chess,
    tier: r.tier,
    dmg: Math.max(1, Math.round(r.dmg)),
  }));
}
