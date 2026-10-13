// ui/gameLogic/phases.js — phase families, banners, the round's result box and 战斗结束 sound, countdowns, the round
// start's deploy replay. Re-exported from ../gameLogic.js.

import { PHASE } from '../../../../shared/constants.js';
import { bossLevelSeconds } from '../matchStatus.js';
import { clamp, int, isObj, sortedPlayers } from './shared.js';
import { normalizeSp } from './draft.js';
import { t } from '../../../../shared/i18n.js';


// ---- phases ----------------------------------------------------------------------------------------

const COMBAT_PHASES = new Set([PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);
const PREP_PHASES = new Set([PHASE.PREP, PHASE.SP_DRAFT, PHASE.ROUND_START]);

/**
 * Which screen family a phase belongs to.
 * @param {string} phase
 * @returns {'loading'|'briefing'|'draft'|'boot'|'prep'|'combat'|'settle'|'result'}
 */
export function phaseMode(phase) {
  if (!phase) return 'loading';
  if (phase === PHASE.INFO_CHECK) return 'briefing';
  if (phase === PHASE.BAND_DRAFT) return 'draft';
  if (phase === PHASE.BATTLE_CHECK) return 'boot';
  if (phase === PHASE.RESULT) return 'result';
  if (phase === PHASE.SETTLE) return 'settle';
  if (COMBAT_PHASES.has(phase)) return 'combat';
  if (PREP_PHASES.has(phase)) return 'prep';
  return 'prep';
}

export const isCombatPhase = (phase) => COMBAT_PHASES.has(phase);
/**
 * The HUD's "你已被淘汰 · 可继续观战队友" pill of an eliminated player: outside combat only — in combat and in the SETTLE
 * after it the combat HUD (screens/game.js CombatHud, rendered for mode 'settle' too) already says it, and two
 * elimination banners never show at once.
 * @param {boolean} alive
 * @param {string|null|undefined} phase
 */
export const showDeadPill = (alive, phase) => !alive && !COMBAT_PHASES.has(phase) && phase !== PHASE.SETTLE;
export const isBossPhase = (phase) => phase === PHASE.FINAL_ASSAULT || phase === PHASE.HIDDEN_CORE;

/**
 * Banner shown when a phase starts: { title, sub?, tone } or null.
 * @param {string|null|undefined} phase
 * @param {any} pub m.public
 * @param {{ alive?: boolean, spectator?: boolean }} [viewer] the local viewer (screens/game.js): `alive` false for an
 *   eliminated player, `spectator` for a spectator seat — it has no row in m.public, so `pub` cannot tell
 */
export function phaseBanner(phase, pub, { alive = true, spectator = false } = {}) {
  const r = int(pub?.round, 0);
  switch (phase) {
    case PHASE.BATTLE_CHECK: return { title: t('协议启动'), micro: 'PROTOCOL START', tone: 'mint', sub: t('模拟即将开始'), duration: 2600 };
    // round income goes to the seats still in only (server/match/match/phases.js startRound; eliminate() zeroes funds
    // and pendingFunds): an eliminated player or a spectator seat reads 观战中, never 资金已到账 (GitHub #236, PR #237)
    case PHASE.ROUND_START: return { title: t('第 {r} 回合', { r }), micro: `ROUND ${String(r).padStart(2, '0')}`, tone: 'mint',
      sub: spectator || alive === false ? t('观战中') : t('资金已到账') };
    case PHASE.SP_DRAFT: return { title: t('机变阶段'), micro: 'CONTINGENCY', tone: 'gold', sub: t('依次选择机变') };
    case PHASE.PREP: return { title: t('休整期'), micro: `ROUND ${String(r).padStart(2, '0')} // REST`, tone: 'mint', sub: t('部署干员，准备迎敌') };
    case PHASE.COMBAT: return { title: t('作战开始'), micro: 'COMBAT', tone: 'orange', sub: t('各自行动阶段') };
    case PHASE.UNITE: {
      const names = new Map(sortedPlayers(pub).map((p) => [p.playerId, p.name || t('博士')]));
      const helpers = Array.isArray(pub?.unite?.helpers) ? pub.unite.helpers.map((id) => names.get(id)).filter(Boolean) : [];
      return { title: t('联防阶段'), micro: 'JOINT DEFENSE', tone: 'orange', sub: helpers.length ? t('联防：{names}', { names: helpers }) : t('完美作战的博士迎战突破防线的敌人') };
    }
    case PHASE.FINAL_ASSAULT: return { title: t('最终攻势'), micro: 'FINAL ASSAULT', tone: 'red', sub: t('击败敌方领袖') };
    case PHASE.HIDDEN_CORE: return { title: t('隐秘核心'), micro: 'HIDDEN CORE', tone: 'red', sub: t('被源石侵蚀的假想敌') };
    case PHASE.SETTLE: return null;
    default: return null;
  }
}

// ---- the round's result box and 战斗结束 sound (GitHub #235; PR #112 by @Convey123) ------------------------------------
// The official round result dialog (research 09 §3.1 "Round result dialog"): 「作战结束」 with 「全员无伤！」, or
// 「生命值减少」 and the LP lost — official words only (the owner's review of PR #112, 2026-10-05: the
// remake's own 「联防成功 / 联防失败：还有 N 只突破防线」 line is not in the official dialog). screens/game.js shows it
// (ui/components.js ResultDialog) and plays the matching BATTLEOVER sound when SETTLE starts — the moment is [ASSUMED]:
// the sources do not time the dialog, and a 联防 leaker's number exists only after the 联防. Boss rounds have no SETTLE
// (最终攻势 / 隐秘核心 go to the result screen or the Hidden Core round), so they get neither [ASSUMED].

/** How long a result box (ui/components.js ResultDialog) stays up, ms — inside SETTLE's 3 s (server DELAYS.SETTLE). */
export const RESULT_BOX_MS = 2800;

/**
 * What this round's own battle cost the viewer: `min(cap, leaks)`, exactly what settlement charges outside a 联防.
 * `cost` is what screens/game.js `roundLossRef` kept while the battle ran — `leaks` = counted enemies that got through
 * (the highest the round showed: the settled state reads 0 again and must not wipe it), `cap` = the per-round LP cap.
 * @param {{ leaks?: number, cap?: number } | null | undefined} cost
 * @returns {number|null} null when this round's battle was never seen (not in the round, a reconnect landing on SETTLE)
 */
export function ownRoundLoss(cost) {
  if (!cost) return null;
  const leaks = Number.isFinite(cost.leaks) ? Math.max(0, Math.trunc(cost.leaks)) : null;
  if (leaks == null) return null;
  const cap = Number.isFinite(cost.cap) && cost.cap > 0 ? Math.trunc(cost.cap) : 10; // no cap known → the official 10
  return Math.min(cap, leaks);
}

/**
 * 战斗结束: one of the official `BATTLEOVER_*` sounds (all three in data/assets.json audio.sfx.ui) — `battleOverReduce`
 * when the round cost the viewer LP, `battleOverNoReduce` when a 联防 ran and the viewer was charged nothing,
 * `battleOverNormal` otherwise; null when this round's battle was never seen. The client data names the three but not
 * their triggers: the mapping is [ASSUMED] (PR #112; the owner's review called the three sounds right).
 * The loss is the authority's per-player charge when a 联防 resolved (`uniteLoss`, m.public.uniteResult.losses — a
 * leaker whose enemies the helpers stopped paid 0), else the own battle's (`ownRoundLoss`).
 * @param {{ leaks?: number, cap?: number, unite?: boolean } | null | undefined} cost
 * @param {number|null} [uniteLoss]
 * @returns {'battleOverReduce'|'battleOverNoReduce'|'battleOverNormal'|null}
 */
export function battleOverSfx(cost, uniteLoss = null) {
  if (!cost) return null;
  // `uniteLoss == null` means "no 联防 figure" (Number(null) would read as 0)
  const authority = uniteLoss == null ? NaN : Number(uniteLoss);
  const loss = Number.isFinite(authority) ? Math.max(0, Math.trunc(authority)) : ownRoundLoss(cost);
  if (loss == null) return null;
  if (loss > 0) return 'battleOverReduce';
  return cost.unite ? 'battleOverNoReduce' : 'battleOverNormal';
}

/**
 * The official round result dialog for the viewer's own LP charge `loss`: 「作战结束」 + 「全员无伤！」 (mint) at 0, else
 * 「生命值减少 −N」 (red).
 * @param {number} loss
 * @returns {{ title: string, micro: string, tone: string, sub: string, duration: number }}
 */
export function roundResultBox(loss) {
  const n = Math.max(0, Math.trunc(Number(loss) || 0));
  return n === 0
    ? { title: t('作战结束'), micro: 'BATTLE OVER', tone: 'mint', sub: t('全员无伤！'), duration: RESULT_BOX_MS }
    : { title: t('作战结束'), micro: 'BATTLE OVER', tone: 'red', sub: t('生命值减少 −{n}', { n }), duration: RESULT_BOX_MS };
}

/**
 * The result box of a round whose 联防 resolved: the same official dialog, its number the authority's charge for the
 * viewer (m.public.uniteResult.losses — in a 联防 a leaker pays for the survivors, not for its own battle's leaks, so the
 * client cannot work it out). The official words only, and only when they are true:
 *   生命值减少 −N  the round charged the viewer N (red);
 *   全员无伤！     nothing got through (`through` 0): nobody paid, true for every participant (mint);
 *   title alone   the 联防 leaked but the viewer was not charged (a helper, a spared leaker — 全员无伤！ would claim the
 *                 teammate who paid was unharmed too, and the official dialog has no other line; orange). Also the
 *                 reading of a view without `losses`, which never falls back to the own battle's leaks.
 * A viewer `losses` does not list — a spectator seat, a player eliminated before the round — gets no box, as in a
 * round without 联防, where a viewer without a battle gets none (and no sound) [ASSUMED].
 * @param {{ through?: number, losses?: Record<string, number> } | null | undefined} res m.public.uniteResult
 * @param {string|null|undefined} selfId the viewer's playerId
 * @returns {{ title: string, micro: string, tone: string, sub: string, duration: number } | null} null: no 联防 resolved, or not in the round
 */
export function uniteResultBox(res, selfId) {
  const through = Number(res?.through);
  if (!isObj(res) || !Number.isFinite(through) || through < 0) return null;
  const losses = isObj(res.losses) ? res.losses : null;
  if (losses && (selfId == null || !Object.hasOwn(losses, selfId))) return null;
  const raw = losses ? Number(losses[selfId]) : NaN;
  const loss = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
  if (loss != null && loss > 0) return roundResultBox(loss);
  if (loss != null && through === 0) return roundResultBox(0);
  return { title: t('作战结束'), micro: 'BATTLE OVER', tone: 'orange', sub: '', duration: RESULT_BOX_MS };
}

/**
 * The result box of a round without 联防: the own battle's cost as kept while it ran (`ownRoundLoss`; the live pending
 * value is 0 again by the time SETTLE renders). null without a battle seen this round.
 * @param {{ leaks?: number, cap?: number } | null | undefined} cost
 */
export function battleResultBox(cost) {
  const loss = ownRoundLoss(cost);
  return loss == null ? null : roundResultBox(loss);
}

/** Label of the prep capsule ("休息一下" in the original). */
export function prepCapsuleLabel(phase) {
  if (phase === PHASE.SP_DRAFT) return t('机变阶段');
  if (phase === PHASE.ROUND_START) return t('回合开始');
  if (phase === PHASE.BATTLE_CHECK) return t('协议启动');
  if (phase === PHASE.SETTLE) return t('回合结算');
  return t('休息一下');
}

// ---- the round start's deploy replay (PR #416) ---------------------------------------------------------------

/**
 * The own board's pieces in deployment order — the order the battle deploys them (sim Battle.start; PRTS 卫戍协议/帮助
 * "按从上到下>从左到右的顺序部署。优先部署干员，随后为召唤物"): the operators by column from the left, top to bottom within a
 * column (col asc, row desc, in board coordinates — so the mirrored right half of a boss prep also starts from its own
 * left), then the summons the same way. A placed item (画卷) is not one of them.
 * @param {any[]|null|undefined} board m.private board
 * @returns {number[]} uids
 */
export function deployOrder(board) {
  const rank = (p) => (p.kind === 'chess' ? 0 : 1);
  return (Array.isArray(board) ? board : [])
    .filter((p) => isObj(p) && Number.isInteger(p.uid) && Number.isInteger(p.row) && Number.isInteger(p.col) && (p.kind === 'chess' || p.kind === 'token'))
    .sort((a, b) => rank(a) - rank(b) || a.col - b.col || b.row - a.row || a.uid - b.uid)
    .map((p) => p.uid);
}

/**
 * Whether the round start's replay is due and which pieces play it (PR #416 by @Cromemadnd; the maintainer's confirmation
 * from official play, 2026-10-13: at the start of every round the operators on the board replay their Start clip and
 * landing sound one after another in deployment order). Due once per round, during 回合开始, on the viewer's own board —
 * never a scouted or watched teammate's board, a spectator seat or an eliminated player — while it holds pieces.
 * `replayed` is the round the screen last scheduled: the screen marks a round only once the field view took the sequence
 * (render/app.js replayDeploys found the pieces), so a view or a board not built yet is asked again on the next render of
 * the phase, and a reconnect or a re-render of the same round replays nothing.
 * @param {{ phase?: string|null, round?: number|null, replayed?: number|null, ownBoard?: boolean, board?: any[]|null }} [s]
 * @returns {{ round: number, uids: number[] } | null}
 */
export function roundStartReplay({ phase = null, round = null, replayed = null, ownBoard = false, board = null } = {}) {
  if (phase !== PHASE.ROUND_START || !Number.isInteger(round) || round === replayed || !ownBoard) return null;
  const uids = deployOrder(board);
  return uids.length ? { round, uids } : null;
}

// ---- countdown -------------------------------------------------------------------------------------

/**
 * Countdown display state.
 * @param {number|null|undefined} deadline server epoch ms (0/null = untimed)
 * @param {number} now server-corrected epoch ms
 * @param {number} [total] total seconds of the phase (for the 5-bar gauge)
 * @param {number} [warnAt] seconds at/below which the digits turn orange
 * @returns {{ remain: number|null, warn: boolean, bars: number, text: string, frac: number }}
 */
export function countdownState(deadline, now, total, warnAt = 10) {
  if (!(Number.isFinite(deadline) && deadline > 0) || !Number.isFinite(now)) {
    return { remain: null, warn: false, bars: 0, text: '--', frac: 0 };
  }
  const remain = Math.max(0, Math.ceil((deadline - now) / 1000));
  const t = Number.isFinite(total) && total > 0 ? total : null;
  const frac = t ? clamp(remain / t, 0, 1) : 1;
  const bars = remain === 0 ? 0 : t ? clamp(Math.ceil(frac * 5), 0, 5) : 5;
  return { remain, warn: remain <= warnAt, bars, text: String(Math.min(999, remain)).padStart(2, '0'), frac };
}

/**
 * Nominal length (s) of the current timed phase from data/config.json, or null when unknown/untimed.
 * @param {any} pub m.public
 * @param {any} config data/config.json
 * @param {string|null} [myId]
 */
export function phaseTotalSeconds(pub, config, myId = null) {
  if (!isObj(pub)) return null;
  const timers = isObj(config?.timers) ? config.timers : {};
  const mode = isObj(config?.modes) ? config.modes[pub.modeId] : null;
  const num = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  switch (pub.phase) {
    case PHASE.INFO_CHECK: return num(timers.infoCheck) ?? 25;
    // one countdown: the current turn's (m.public.draft.turnSeconds = Match.BAND_TURN_SECONDS; user playtest #4 item 4)
    case PHASE.BAND_DRAFT: return num(pub.draft?.turnSeconds) ?? num(timers.bandTurn) ?? 30;
    case PHASE.BATTLE_CHECK: return num(timers.battleCheck) ?? 3;
    case PHASE.SP_DRAFT: {
      const sp = normalizeSp(pub.sp, pub.players);
      const first = !sp || sp.pickedCount === 0;
      return first ? (num(timers.spFirst) ?? 30) : (num(timers.spTurn) ?? 16);
    }
    case PHASE.PREP: return num(mode?.rounds?.[String(pub.round)]?.prepTime);
    case PHASE.COMBAT:
    case PHASE.UNITE: return num(mode?.rounds?.[String(pub.round)]?.combatTimeLimit);
    // 最终攻势 / 隐秘核心: m.public.deadline is the level's 120 s countdown (maxPlayTime; the battle goes on past it)
    case PHASE.FINAL_ASSAULT:
    case PHASE.HIDDEN_CORE: return bossLevelSeconds(pub, config);
    default: return null;
  }
}
