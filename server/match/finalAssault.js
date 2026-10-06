// server/match/finalAssault.js — 最终攻势 (R14 / solo FUNNY R9) and 隐秘核心 (R15) helpers (DESIGN §6.1, research
// 00-INDEX §5, 06 §10).
//
//   * Merged LP: teamLp = Σ LP of the alive players at the start of the Final Assault (no cap); the Hidden Core
//     continues with what is left.
//   * Pairing: alive players by seat → (1,2), (3,4); an odd player is alone on its own field with the `_s` template
//     (solo modes always use `_s`). Field ids 'b1', 'b2'. In a pair the first player is the LEFT side, the second the
//     RIGHT side (the sim mirrors the right side: board col c → field col 20 − c with the piece direction RIGHT ↔
//     LEFT, UP / DOWN unchanged (DESIGN §3, research 09 §1.2 ConvertChessPositionInfoToBossMap); board rows 9–12 →
//     boss rows 2–5, sim/constants BOSS_ROW_OFFSET). `bossFieldPlacement` gives that mapping for UIs / tools.
//   * Shared boss pool: per-player bloodPoint times living participants at round start; escorts are not scaled by player count.
//   * Overtime: bossTurnHpReduceTime counts REAL seconds like the level's 120 s maxPlayTime (which runs out first; the
//     battle goes on): from 150 real s (300 game s on the 2× field clock) the team loses bossOvertimeDrainPerSec (1) LP
//     per real second (gamedata.js bossOvertimeDue); m.public.deadline = the 120 s countdown, m.public.overtimeAt = the
//     drain start. Minion / boss leaks cost their `lpr`; team LP 0 ⇒ defeat (all fields force-ended; PRTS 卫戍协议：盟约 下半
//     "…使目标生命值扣除至0，则无视倒计时直接失败"); pool 0 ⇒ victory. The first of the two the server registers decides
//     (Match._finalEnding): a report that arrives after the team LP ran out credits nothing (user playtest #6 item 5).
//   * Pool HP is a float that never keeps float dust: the hit that would leave less than BOSS_POOL_MIN_HP (1) takes the
//     rest, so the pool is 0 or ≥ 1 and a leader shown at 0 HP is down (sim/constants.js; the browser's LocalBossPool
//     follows the same rule, server/sim/spec.js). Before, the per-player crediting of a report could leave 3.6e-12 that
//     the browser could never deal (user playtest #6 item 5).
//   * No IN_BATTLE layer gains (flags.layerGainsEnabled = false).
//   * BOSS_HIT tickers (BOSS_HIT_STEPS 20 / 50 / 80 %): a player's damage to the round's pool (SharedBossPool.byPlayer)
//     over its size, each threshold once per boss round — the Hidden Core never counts the Final Assault's damage
//     (player report after 0.1.0: "隐藏boss还没打就出了造成50%伤害播报").
//   * Hidden Core eligibility (after an R14 win): difficulty in hiddenCore.difficulties, the mode has a hidden round,
//     Σ activated layers of the alive players measured at the end of the boss round's prep > threshold (solo 350 /
//     co-op 1200) and team LP > minTeamLpExclusive (1).

import { BOSS_ROW_OFFSET, COLS, BOSS_POOL_MIN_HP } from '../sim/constants.js';
import { mirrorDir, normDir } from '../sim/dir.js';
import { bossPlayerCount } from './gamedata.js';

/**
 * BOSS_HIT ticker thresholds (activity_table autoChessData.broadcastList comment_boss_hit_1..3, paramList 0.2 / 0.5 /
 * 0.8: "{0}博士对敌方领袖造成的伤害超过20%!"): a player's damage to the current leader's pool over that pool
 * (SharedBossPool.byPlayer — one pool per boss round, so the Final Assault and the Hidden Core count apart).
 */
export const BOSS_HIT_STEPS = [0.2, 0.5, 0.8];

/**
 * Where a board piece (board row / col / dir) stands on a boss field for side 'L' | 'R' — the same mapping as the
 * sim (Battle.mapTile / mapDir): rows 9–12 → 2–5; the right side mirrored col c → 20 − c, RIGHT ↔ LEFT.
 * @returns {{ row: number, col: number, dir: 'UP'|'RIGHT'|'DOWN'|'LEFT' }}
 */
export function bossFieldPlacement(side, row, col, dir = 'RIGHT') {
  const d = normDir(dir);
  const r = row >= 7 ? row + BOSS_ROW_OFFSET : row;
  return side === 'R' ? { row: r, col: COLS - 1 - col, dir: mirrorDir(d) } : { row: r, col, dir: d };
}

/** Pair alive players by seat: [[a, b], [c, d]] / [[a, b], [c]] / [[a]]. */
export function pairPlayers(alive) {
  const sorted = alive.slice().sort((a, b) => a.seat - b.seat);
  const groups = [];
  for (let i = 0; i < sorted.length; i += 2) groups.push(sorted.slice(i, i + 2));
  return groups;
}

/** Boss HP = per-player bloodPoint times participants; omitted count means one player. */
export function bossPoolHp(gd, bossId, aliveCount) {
  const boss = gd.boss(bossId);
  const diff = gd.difficulty;
  let base = boss && boss.bloodPoint && Number.isFinite(boss.bloodPoint[diff]) ? boss.bloodPoint[diff] : null;
  if (base == null && boss && boss.bloodPoint) base = Object.values(boss.bloodPoint).find((v) => Number.isFinite(v)) ?? null;
  if (base == null) base = 500000;
  const tune = typeof gd.bossHpMul === 'function' ? gd.bossHpMul(bossId) : 1;
  let share;
  if (typeof gd.bossPoolShare === 'function') share = gd.bossPoolShare(aliveCount);
  else {
    share = gd.isSolo ? 1 : bossPlayerCount(aliveCount);
  }
  return Math.max(1, Math.round(base * share * tune));
}

/**
 * The one HP pool every boss field damages. `damage(playerId, amount)` is called by the sim (server-run fields) and by
 * Match._creditBoss (client reports, per player); the hit that would leave less than BOSS_POOL_MIN_HP takes the rest.
 */
export class SharedBossPool {
  constructor(hp, { onHit = null } = {}) {
    this.maxHp = Math.max(1, hp);
    this.hp = this.maxHp;
    /** playerId → damage dealt to this pool (this boss round only; the BOSS_HIT tickers' share) */
    this.byPlayer = new Map();
    this.onHit = onHit;
  }

  damage(playerId, amount) {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0 || this.hp <= 0) return 0;
    const dealt = this.hp - a < BOSS_POOL_MIN_HP ? this.hp : a;
    this.hp -= dealt; // exactly 0 when the rest is taken (x − x): no float dust
    if (playerId != null) this.byPlayer.set(playerId, (this.byPlayer.get(playerId) || 0) + dealt);
    if (this.onHit) {
      try { this.onHit(playerId, dealt); } catch { /* reported by the caller */ }
    }
    return dealt;
  }
}

/**
 * Hidden-core eligibility.
 * @param {import('./gamedata.js').GameData} gd
 * @param {{ layerSum: number, teamLp: number }} s
 */
export function hiddenEligible(gd, { layerSum, teamLp }) {
  const hc = gd.hiddenCore;
  if (!gd.hiddenRound || !hc.difficulties.includes(gd.difficulty)) return false;
  const threshold = gd.isSolo ? hc.single : hc.multi;
  return layerSum > threshold && teamLp > hc.minTeamLpExclusive;
}

/**
 * A boss field the server takes over mid-fight (its client left, DESIGN §14) re-simulates its spec from t = 0. The
 * damage its client already reported (`acked`, cumulative, per player in `ackedBy`) is in the shared pool, so this
 * wrapper credits the real pool only with what the re-simulation deals beyond it. Reads (hp, maxHp) go to the pool.
 */
export class CreditPool {
  /**
   * @param {SharedBossPool} pool
   * @param {{ acked?: number, ackedBy?: Record<string, number>, onCredit?: (playerId: string|null, amount: number) => void }} [o]
   */
  constructor(pool, { acked = 0, ackedBy = {}, onCredit = null } = {}) {
    this.pool = pool;
    this.acked = Math.max(0, Number(acked) || 0);
    this.ackedBy = { ...ackedBy };
    this.cum = 0;
    this.onCredit = onCredit;
  }

  get hp() { return this.pool.hp; }
  set hp(v) { /* the sim's fallback path writes hp only when damage() threw; the real pool is never written here */ void v; }
  get maxHp() { return this.pool.maxHp; }

  damage(playerId, amount) {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return 0;
    const before = this.cum;
    this.cum += a;
    const credit = Math.max(0, this.cum - Math.max(before, this.acked));
    if (credit <= 0) return 0;
    const dealt = this.pool.damage(playerId, credit);
    if (dealt > 0 && this.onCredit) { try { this.onCredit(playerId, dealt); } catch { /* reported by the caller */ } }
    return dealt;
  }
}
