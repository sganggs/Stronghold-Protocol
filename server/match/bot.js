// server/match/bot.js — AI player (DESIGN §6.6). Used for AI teammates and "AI 托管" (g.autoplay; a departed human
// is eliminated, Match._quit). Every action goes through the same validated
// PlayerState handlers a human uses; randomness only from the match's bot rng (deterministic per seed).
//
// It reads only what a player can see: its own state, the shop, the shared pool's copies left, the teammates' bond
// strips, and the round's enemy preview (composition and routes, research 06 §4.3 "查看当前回合即将迎击的敌方单位").
//
// Prep routine (botPrep):
//   1. take a pending reward offer (merge progress, bond synergy, tier)
//   2. economy. The bond plan (bondPlan): a focus core bond — owned members, members the shop can still bring at this
//      level, banked layers, last round's focus (commit instead of flip-flopping), minus a teammate's main core bond
//      (its bond strip; the shop pool is shared) — and a second bond (most owned members, next threshold within
//      reach). Keepers: the deployed operators, focus / second members, chess of tier ≥ shop level − 1. Sell bench
//      chess that neither make the lineup nor build toward something (a pair whose third copy can still come, a
//      keeper, an elite; ≤ BENCH_BUDGET spare units, pairs first), buy toward a full board (the deploy cap is 8 from
//      round 1), complete every merge it can afford — before a level-up can spend the funds —, level the 调度中心 on a
//      curve (free levels always; the −1/round discount is waited for early), then spend the rest (leftover funds are
//      lost at prep end; a band that keeps them, 坎诺特, holds its interest capital back — fundsReserve): with a full
//      board a purchase must be merge progress or a lineup upgrade AND worth more than the refreshes its price would
//      pay for — refreshValue: Σ over the held pairs of P(a refresh shows the third copy, the shop's copy-weighted odds
//      over the shared pool) × MERGE_HIT (an elite plus the merge's free pick of the next tier) — else it refreshes. A
//      third copy it cannot afford freezes the shop for the next round (maybeFreeze). Purchase scores: merge progress >
//      bond thresholds (focus, second) > role needs (blockers, anti-air when the wave flies, one or two healers) >
//      tier and armour fit (the share of a dealer's damage the round's DEF / RES lets through, effDps; an attack on every
//      enemy in range — 阵法术师 / 轰击术师 — counts double, splash and chain a little, CROWD). A merge that
//      consumes a deployed copy leaves the elite on that copy's tile (PRTS 卫戍协议/帮助, PlayerState._mergeChess):
//      nothing here assumes it in the hand — steps 3–4 plan it like any owned unit (kept, moved or benched).
//   3. lineup: the deployed set maximizes unit value (tier, elite, items, armour fit) + activated bond tiers (exact
//      counting via computeBonds; every deployed focus member counts toward the next threshold) + composition
//      (chooseLineup: greedy seed + swap hill-climbing).
//   4. placement (planLayout): the round's routes are traced over the own board from the enemy preview (ground
//      routes on the stage's device-aware ground paths, flying routes through their checkpoints; 近地悬浮 enemies walk
//      the ground path but count as flyers) and weighted by their enemies; an exposure model (tile time × DPS of the
//      covering units against the round's DEF / RES, blocker hold time, flyers only for anti-air) is maximized
//      greedily — blockers first, then damage dealers by DPS, then healers — over every
//      (legal tile, direction) pair of the server's deploy map (no 深水区). A MELEE operator is planned on the ground
//      tiles, where it blocks — except one whose trait reads 「可以放置于远程位」 (歌蕾蒂娅, 崖心, 见行者, any module:
//      placeClass 'all', shared/highGround.js), which takes a 高台 whose range covers the enemy road, else the ground
//      (owner 2026-10-04 for the 高台 preference, 2026-10-05 for who may use one). It stays a blocker in the lineup
//      (basePositionClass). A blocker whose range grid is its own tile only (range 0-1: 角峰, 古米, 泡泡, 折桠, 菲莱, 蛇屠箱,
//      塞雷娅, 余) is planned on a free tile of the enemy road first: off it nothing is blocked or hit. Each unit's range grid — the one it is
//      deployed with, rangeRec (loadoutRecord attackRangeGrid; 信仰搅拌机 S3 uses that skill's grid as-is, #31) — is rotated per direction (DESIGN §3; RIGHT is tried first
//      and kept on ties, so symmetric ranges and melee units whose front adds nothing stay facing the gates), so
//      ranged units turn toward the enemy path tiles they cover best and blockers toward the road; on 气流 tiles
//      (act2 m01 blowers) the DPS is scaled by the blower ATK bonus of that direction (with / against / across). The last
//      arrangement of a prep REHEARSES up to m.botRehearsal distinct layout variants with the real Battle and normal
//      battle inputs (isolated preview dispatch, no settlement) and keeps the one with the fewest leaks. The default plan is
//      placed first; Match steps the rehearsal in wall-clock-bounded slices (botPrepBegin → job.run → botPrepEnd) so
//      whole simulated battles never block the server's event loop. With `m.botRehearsalDelegate` an AI teammate's
//      candidates go to the current host's browser instead (a human seat under AI 托管 keeps the server's rehearsal)
//      and the server simulates them only when nobody answers (MatchRehearsal).
//      The prep routine itself is sliced the same way:
//      botPrepBeginSteps / botPrepEndSteps (and planLayoutSteps, arrangeSteps, createRehearsalSteps) are step
//      generators that yield between whole actions (never with a transient board) — the same actions in the same
//      order as the one-shot functions (runSteps), hence the same rng draws and decisions.
//      The summon cards of the placed operators (赫默's 医疗探机, 伺夜's 狼群 …; user playtest #6) are placed after
//      them on the best remaining tiles — a tactician's 援军 (狼群 / 流形) only on a tile of its owner's attack range
//      (its tactical point: PlayerState.summonRange, the server's legality; player report #9 after 0.1.0) —, 凯瑟琳's
//      支援装置 next to the best operator no device faces yet, facing it. Legality is the server's: the bot plans on the deploy map (board.js legalTiles) and
//      a tile g.move refuses is skipped for the next best one.
//   5. items by what they do (itemTarget): equipment on the strongest deployed damage dealers (survival items on
//      blockers, bond signature items on a member), 信标 on a bench single, 拟态物质 on a pair, 博士投影 (both
//      qualities) on the strongest normal operator, 突变细胞 on the least valuable normal single below 6阶 (cellTarget:
//      never an elite or a pair member; the operator its transformation gains joins the bench — the buy loop's bench
//      shed leaves a piece gained since the last prep alone, rememberOwned — and steps 3–4 of the next prep deploy it
//      like any owned unit), bond items on a focus member; Arts (useArt): 画卷 copies the most valuable
//      deployed operator, 教鞭 / “神秘顾客” are used after a perfect battle and kept otherwise (consume-on-equip items /
//      Arts only with a handler)
//   6. resolve the temp slots (a 突变细胞 left there — it comes back after every transformation — gets a hand slot made
//      for it, makeHandRoom, instead of being destroyed), keep one hand slot free (freeHandSlot: a kept bounty Art goes
//      before a chess on a bot's own seat, never on a human's seat under AI 托管), then Ready.
// Strategy (botPickBand): weighted by starting LP among the offered bands; never one whose mechanic rides on a bond the
// mode switches off (gd.bandBondIds = bands.json bondIds: the bond its text names in <…> or its blackboards name — 标准's
// 潘格尼尼, 克莱门莎, 玛恩纳; DESIGN §21.26); alone, 老鲤's withheld first-round funds only rarely (× 0.02).
// 机变 (botPickCard): a bounty by its expected payout minus the expected LP lost — bountyKillChance runs the exposure
// model for that one enemy against the own board; a card the board is unlikely to beat wins only when nothing better
// is offered or it pays much more —; tactic cards by what they act on (a 盟誓 / 驰援 card on the own bonds, 升华 …);
// items by tier and use.
// Placement quality (tools/matchrun sweeps, research-faithful waves): the planner beats random layouts by ≈ 8 points
// of kill rate and rehearsal adds ≈ 5 more; see docs/META.md §1.5. Old vs new decisions on the same seeds:
// tools/botbench.mjs.

import { advisorPlan, planContains, planUnitWeight, planPlacementWeight, planBuyTarget, ownsElite } from './aiPlan.js';
import { economyPlan, advisorWanted, advisorBanks, fundAdvisorPurchase, advisorFreezeTarget, advisorProtected, advisorSaleRank } from './aiEconomy.js';
import { createPrepSteps } from './botPrep.js';
import { refineFormationSteps } from './botFormationCandidates.js';
import { ASPD_MIN } from '../sim/constants.js';
import { rehearsalCap, RehearsalRun } from '../sim/rehearsal.js';
import { deriveSeed } from '../sim/rng.js';
import { freeSlot, countFree, legalTiles, canPlace, positionClass, placeClass, basePositionClass, parseKey, tileKey, FIELD, pieceDir, boardTileOf, BOSS_MIRROR_COL } from './board.js';
import { rotateOffset, normDir, mirrorDir, oppositeDir } from '../sim/dir.js';
import { itemKey } from './gamedata.js';
import { computeBonds } from './bondsMeta.js';
import { isFlyKey, bountySpawns } from './waves.js';
import { previewPlayer } from './preview.js';
import { bossPoolHp, SharedBossPool } from './finalAssault.js';
import { GEO } from '../../shared/constants.js';
import { mitigate } from '../sim/attack.js';
import { HOVER_KEYS } from '../sim/content/enemies.js';
import { attackRangeGrid, loadoutRecord, resolveRecordLoadout } from '../../shared/loadoutRecord.js';
import { morphSlotPolicy, ruleOption } from '../../shared/plugins/rules.js';

/**
 * Drive a step generator (planLayoutSteps, createRehearsalSteps, arrangeSteps, botPrepBeginSteps …) to its end in one
 * go and return its value — the synchronous form every step generator also has (tools, tests, botPrep).
 */
export function runSteps(gen) {
  let r;
  do r = gen.next(); while (!r.done); // loop-cap: generator
  return r.value;
}

/**
 * [ASSUMED] §35.63: share of an advisor plan's unit weight (aiPlan planUnitWeight, up to +48) in a piece's lineup and
 * bench value. Unit power runs 10-25 and computeBonds already scores the plan's bonds exactly, so the full weight
 * benched tier 5/6 carries for tier 1-2 plan members (27 of 38 LLM preps from R10).
 */
const PLAN_UNIT_SHARE = 0.25;
/** Lineup value of each deployed member of the focus bond (up to its top threshold). */
const FOCUS_MEMBER = 4;
/**
 * [ASSUMED] §35.62: lineup value of a core bond at its second tier or above (6 拉特兰 / 叙拉古 …, 5 阿戈尔), on top of the
 * linear tier weight. The guides build around a 6-member main (handoff/round51 RESEARCH §2); measured on ABYSS solo, a
 * linear weight never fielded one (boards stayed 3 + 3 + 3) even with 6 distinct members owned.
 */
const CORE_TOP_TIER = 30;
/** [ASSUMED] §35.62: bench members of a core bond with at least this many distinct owned members are not sold as junk. */
const CORE_KEEP_OWNED = 4;
/**
 * [ASSUMED] §35.63 commitment to a 6-member core: last round's focus keeps CORE_LOCK (was 6) once 3 members are owned, a
 * new focus member is worth CORE_MEMBER more on the way to the top threshold, and a refresh that may show one is worth
 * CORE_HIT × P(shown) (coreGap).
 */
const CORE_LOCK = 16;
const CORE_MEMBER = 10;
const CORE_HIT = 20;
/**
 * [ASSUMED] §35.63 sustain floor: from HEAL_FROM the lineup values its first healer at HEAL_FIRST and a second one from R9
 * at HEAL_SECOND (buyScore: the first healer +14, a second from R8 +4). Bots fielded 0.1–0.5 healers in R4–R13 and died
 * to DOT / ELEMENT / SPECIAL rounds; 终极 co-op seats alive at the Final Assault rose with it.
 */
const HEAL_FROM = 5;
const HEAL_FIRST = 16;
const HEAL_SECOND = 6;
/** Value per unit of armour fit (the share of a dealer's damage the round's DEF / RES lets through, armorFit). */
const ARMOR_WEIGHT = 10;
/** Least buy score of a purchase once the board is full (below it the bot refreshes instead). */
const BUY_FULL_MIN = 8;
/**
 * Value of completing an elite (+25 % stats, skill level 7, and the merge's free pick of three tier min(level + 1, 6)
 * chess — worth having for any pair, a cheap one included) and of making a keeper's pair; refreshValue weighs them by
 * the shop odds.
 */
const MERGE_HIT = 36;
const PAIR_HIT = 8;
/** Pairs the bench holds at once while refreshes hunt their third copies (each takes a hand slot or two). */
const MAX_PAIRS = 4;
/** Refreshes per prep at most (funds bound them first). */
const MAX_REFRESHES = 16;
/** Spare bench units kept beyond the lineup at the prep start (pairs first). */
const BENCH_BUDGET = 6;
/**
 * Shop level the bot aims for at the start of round r (index = round). §35.63: L5 at R9 and L6 at R11 (were R10 / R12),
 * the community rhythm 3-5-7-9 (BV19UXZBJExQ reply; handoff/round51 RESEARCH §3.2) plus one step: 终极 solo boards
 * reached the Final Assault short of leader damage, and bots on this curve dealt about 40 % more of it.
 */
const LEVEL_TARGET = [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6, 6];
/**
 * AI 托管 of a human with 自选 picks (0.2.0; bots field none): the buy score of one of the player's own slotted pieces —
 * the operator the player chose to field (follow-up #13: under AI 托管 they were rarely bought) — and the 调度中心 is
 * levelled one round earlier for the step that opens a slotted tier (levelUp).
 */
export const DIY_PIECE_BONUS = 12;
const TIER_POWER = [0, 10, 12.5, 15, 18, 21.5, 25];
/** Prep-side 特质 that keep adding bond layers every round / every refresh (a player's main layer engine). */
const RECURRING_TRAIT_EVENTS = new Set(['SERVER_PREP_START', 'SERVER_PREP_FIN', 'SERVER_REFRESH_SHOP']);
const LAYER_TRAIT_RE = /BOND|LAYER/;
const ECON_TRAIT_RE = /GOLD|REFRESH|COIN/;
const DEFAULT_MELEE_RANGE = [[0, 0], [0, 1]];

/**
 * Band pick among the strategies the mode offers (gd.bandIds): weighted by starting LP (sturdier strategies are
 * preferred). Alone, a band that withholds the first rounds' funds (老鲤 "资金暂存": no operator in R1–R2, every enemy
 * leaks) is avoided — only 联防 teammates cover that. A band whose mechanic rides on a bond the mode switches off
 * (gd.bandBondIds ∩ gd.modeInactiveBonds — 标准: 潘格尼尼 <拉特兰>, 克莱门莎 <阿戈尔>, 玛恩纳 <卡西米尔>) weighs 0, never taken
 * (DESIGN §21.26). [ASSUMED] A living teammate's opening strategy soft-reserves those bonds before anyone is deployed:
 * the weight stays positive, at a quarter of the unreserved weight, so the strategy can still be drawn, and the
 * reservation ends when that teammate is eliminated (alivePlayers). #121 [ASSUMED]: a band whose mechanic also changes
 * the teammates' enemies (鸭爵 「神秘顾客」: from R5 some enemies of the player AND the teammates become 鸭爵 / 高普尼克 /
 * 流泪小子 / 圆仔, which break through boards built for the normal wave) burdens the whole team, so it keeps a tenth of its
 * weight while a teammate lives (MATE_BURDEN); alone it only touches the own field. With every band excluded, the
 * default band. One rng draw per call (deterministic per seed); a solo match has no teammate to reserve against.
 */
const SOFT_BAND_RESERVE = 0.25;
const MATE_BURDEN = 0.1;
export function botPickBand(m, ps) {
  const gd = ps?.gd || m.gd;
  const ids = gd.bandIds();
  if (!ids.length) return gd.defaultBandId;
  const lateFunds = (id) => /暂存/.test(String(gd.band(id)?.desc || ''));
  const burdensMates = (id) => /队友遭遇/.test(String(gd.band(id)?.desc || ''));
  const mates = ps && typeof m.alivePlayers === 'function' ? m.alivePlayers().filter((p) => p !== ps) : [];
  const reserved = new Set(mates.flatMap((p) => gd.bandBondIds(p.bandId)));
  const inactive = (id) => gd.bandBondIds(id).some((b) => gd.modeInactiveBonds.has(b));
  const pairs = ids.map((id) => {
    if (inactive(id)) return [id, 0];
    const w = Math.max(1, (gd.startLp(id) - 18) ** 2) * (m.isSolo && lateFunds(id) ? 0.02 : 1)
      * (mates.length && burdensMates(id) ? MATE_BURDEN : 1);
    return [id, gd.bandBondIds(id).some((b) => reserved.has(b)) ? w * SOFT_BAND_RESERVE : w];
  });
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = m.rngBots() * total;
  if (!(total > 0)) return gd.defaultBandId;
  let last = null;
  for (const [id, w] of pairs) {
    if (!(w > 0)) continue;
    last = id;
    r -= w;
    if (r < 0) return id;
  }
  return last;
}

/**
 * 机变 card pick among the untaken indexes (a draft is one family: generateDraft). Bounties (extra enemies in the own
 * next battles) score their expected payout minus the expected LP lost (bountyScore: the enemy against the own board —
 * an expected-value comparison, so a card the board is unlikely to beat is taken only when no better one is offered or
 * its pay outweighs the expected leaks); items by tier and use (an item the bot cannot use is worth little); tactic
 * cards by what they act on (tacticScore: a 盟誓 / 驰援 card on the own bonds, 升华 …). Across families items and team
 * buffs come before bounties.
 */
export function botPickCard(m, ps, cards, available) {
  let best = available[0];
  let bestScore = -Infinity;
  for (const i of available) {
    const c = cards[i];
    if (!c) continue;
    let s = 0;
    if (c.kind === 'item') s = 8 + (c.tier || 1) * 4 + (canUseItem(m, ps, { id: c.id }) ? 0 : -8);
    else if (c.kind === 'bounty') s = bountyScore(m, ps, c);
    else if (c.kind === 'tactic') s = tacticScore(m, ps, c);
    s += m.rngBots() * 0.5;
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}

/**
 * Chance that the own board as it stands (the 机变 draft comes before the prep) kills one enemy of a bounty card: the
 * planner's exposure model (Layout) for that single enemy — its HP × the round's multiplier against Σ over the tiles of
 * its route (the busiest route of its kind: flyers the flying routes, else the ground ones) of the time it spends there
 * × the DPS of every deployed unit covering the tile against its DEF / RES (dpsVs; flyers anti-air only), plus the
 * first blocker's hold on the ground. 0.5 without data.
 */
export function bountyKillChance(m, ps, card) {
  const gd = ps?.gd || m.gd;
  const e = card && gd.enemy(card.enemyKey);
  if (!e || !e.stats) return 0.5;
  const model = fieldModel(m, ps);
  const sc = gd.enemyScale(m.round);
  const hp = Math.max(1, (e.stats.maxHp || 1000) * sc.hpMul);
  const def = e.stats.def || 0;
  const res = e.stats.res || 0;
  const fly = isFlyKey(gd, card.enemyKey) || HOVER.has(card.enemyKey);
  const same = model.routes.filter((r) => !!r.fly === fly);
  const pool = same.length ? same : model.routes;
  if (!pool.length) return 0.5;
  const route = pool.reduce((a, b) => (b.n > a.n ? b : a));
  const speed = Math.max(0.05, (e.stats.moveSpeed || 1) * sc.speedMul);
  const tileTime = Math.max(0.4, Math.min(6, 1 / (speed * 0.5)));
  const units = [];
  for (const [k, p] of ps.board) {
    const rec = p.kind === 'token' ? gd.token(p.id) : rangeRec(ps, gd.chess(p.id));
    if (!rec) continue;
    const [r, c] = parseKey(k);
    const u = unitOf(rec, k, r, c, pieceDir(p), model);
    u.vs = dpsVs(rec, def, res) * u.atkMul;
    units.push(u);
  }
  let exp = 0;
  let held = false;
  for (const k of route.tiles) {
    let t = tileTime;
    if (!fly && !held && units.some((u) => u.block > 0 && u.key === k)) { t += LAYOUT_PARAMS.hold; held = true; }
    let dps = 0;
    for (const u of units) if (u.cover.has(k) && (fly ? u.air : u.ground)) dps += u.vs;
    exp += t * dps;
  }
  return 1 - Math.exp(-exp / (BOUNTY_KILL * hp));
}

/** Exposure (× HP) a bounty enemy needs for a 63 % kill chance (conservative: it fights beside the wave). */
const BOUNTY_KILL = 2;

/**
 * Expected value of a bounty card: per battle it lasts, P(kill) × coin (kill payout) or P(kill)^n × coin (perfect
 * payout) minus the expected leaks × the value of an LP (2 + 20 / LP: dearer when low).
 */
function bountyScore(m, ps, card) {
  const p = bountyKillChance(m, ps, card);
  const n = Math.max(1, card.count || 1);
  const battles = Math.max(1, Math.min(3, card.rounds || 1));
  const lpCost = 2 + 20 / Math.max(1, ps.lp);
  const coin = Math.max(0, card.coin || 0);
  const gain = card.payout === 'perfect' ? p ** n * coin : p * n * coin;
  return battles * (gain - (1 - p) * n * lpCost);
}

/** 机变 tactic card value by its effect (data/effects.json buffs), team cards a little more (teammates get it too). */
function tacticScore(m, ps, card) {
  const eff = m.gd.effect(card.id);
  const buffs = eff && Array.isArray(eff.buffs) ? eff.buffs.filter(Boolean) : [];
  const owned = ownedBonds(m, ps);
  const plan = bondPlan(m, ps, owned);
  const rel = (b) => (b === plan.focus ? 1 : b === plan.second ? 0.7 : (ps.bonds[b] && ps.bonds[b].active) ? 0.5 : owned.counts.get(b) ? 0.25 : 0.05);
  let s = 8;
  for (const b of buffs) {
    const bb = b.bb || {};
    const bs = b.bbStr || {};
    const count = Number.isFinite(bb.count) ? bb.count : 1;
    switch (b.key) {
      case 'global_special_choice_bond_addlayer': {
        let r = 0;
        for (const id of String(bs.bond_list || '').split(',').map((x) => x.trim()).filter(Boolean)) r = Math.max(r, rel(id));
        s = 4 + r * count * 1.2;
        break;
      }
      case 'single_special_choice_gain_bond_chess': s = 5 + rel(bs.bond) * 10; break;
      case 'single_special_choice_gloden_char_chess': s = 16; break;
      case 'single_special_choice_gloden_equip_chess': s = 9; break;
      case 'global_special_choice_gain_equip': s = 10; break;
      case 'global_special_choice_refresh_free': s = 7 + count * 0.5; break;
      case 'global_special_choice_gain_coin': s = 4 + count; break;
      // 锐利 needs an empty hand at the prep end — the bot keeps a bench
      case 'global_special_choice_prep_finish_bench_at_most': s = 3; break;
      default: break;
    }
  }
  return s + (card.team ? 3 : 0);
}

// ---------------------------------------------------------------------------------------------------
// evaluation helpers

// a player's record of a chess id (its data view: a human's slotted 自选 slots are its operators, 0.2.0 player/diy.js)
const chessRec = (m, id, ps = null) => (ps?.gd || m.gd).chess(id);
const isHealer = (c) => !!c && (c.dmgType === 'heal' || c.attackKind === 'heal');
// the record's own position: a 钩索师 / 推击手 is a MELEE blocker like any other (a 高台 does not block)
const isBlocker = (c) => !!c && basePositionClass(c) === 'melee' && (c.stats?.blockCnt ?? 1) > 0 && c.attackKind !== 'none';
/** 近地悬浮 enemies walk a ground route but are air units (no block, anti-air only — DESIGN §19). */
const HOVER = new Set(HOVER_KEYS);
const hitsFly = (c) => !!c && !!c.canHitFly && !isHealer(c) && c.attackKind !== 'none';

/** Distinct owned members per bond (board + hand + temp), and per-bond member sets. */
function ownedBonds(m, ps, exclude = null) {
  const counts = new Map();
  const seen = new Set();
  for (const p of ps.allChess()) {
    if (exclude && p.uid === exclude) continue;
    const base = m.gd.baseIdOf(p.id);
    if (seen.has(base)) continue;
    seen.add(base);
    const c = chessRec(m, p.id, ps);
    for (const b of (c && c.bonds) || []) counts.set(b, (counts.get(b) || 0) + 1);
  }
  return { counts, bases: seen };
}

/**
 * Per bond, from one pass over the shared pool: `reach` = distinct unowned members of tier ≤ shop level + 1 with copies
 * left (what the shop can still bring soon — a teammate draining a bond, or a bond of high-tier members only, makes it
 * a poor target), `supply` = the copies left of all its members.
 */
function bondPoolStats(m, ps, owned) {
  const reach = new Map();
  const supply = new Map();
  const maxTier = Math.min(6, ps.shop.level + 1);
  for (const [id, e] of m.pool.entries) {
    if (!(e.left > 0)) continue;
    const c = m.gd.chess(id);
    if (!c || !Array.isArray(c.bonds)) continue;
    const reachable = c.tier <= maxTier && !owned.bases.has(m.gd.baseIdOf(id));
    for (const b of c.bonds) {
      supply.set(b, (supply.get(b) || 0) + e.left);
      if (reachable) reach.set(b, (reach.get(b) || 0) + 1);
    }
  }
  return { reach, supply };
}

/**
 * A teammate's main core bond as every player sees it (its public bond strip, ps.bonds): the core bond with the most
 * counted members, ≥ 2 (ties: data order); null when it builds none yet. Humans and bots alike.
 */
function mainCoreBond(m, p) {
  let top = null;
  let topN = 1;
  for (const id of m.gd.bondIds) {
    const b = p.bonds && p.bonds[id];
    const n = b ? b.count || 0 : 0;
    if (n > topN && m.gd.bond(id)?.isCore) { topN = n; top = id; }
  }
  return top;
}

/**
 * #121: the bonds the living teammates need, as every player sees them — each one's opening strategy bonds and its main
 * core bond (mainCoreBond, its public bond strip) — minus the bonds the own opening strategy needs and the bonds the
 * mode switches off. Humans and bots alike; an eliminated teammate needs nothing; empty alone.
 */
function teammateBonds(m, ps) {
  const out = new Set();
  if (!ps || typeof m.alivePlayers !== 'function') return out;
  const gd = ps.gd || m.gd;
  const own = new Set(gd.bandBondIds(ps.bandId));
  for (const p of m.alivePlayers()) {
    if (p === ps) continue;
    for (const id of [...gd.bandBondIds(p.bandId), mainCoreBond(m, p)]) {
      if (id && !own.has(id) && !gd.modeInactiveBonds.has(id)) out.add(id);
    }
  }
  return out;
}

/**
 * The bonds the bot builds around (cached per round, owned set and public teammate claims): `focus` = the core bond with the best
 * owned members × 10 + reachable members (bondPoolStats, ≤ 4) + layers already banked (≤ 6) + commitment (16 with
 * ≥ 3 members, else 6). [ASSUMED] Subtract 30 for a living teammate's public main or opening strategy bond, except
 * bonds required by the own opening strategy (teammateBonds). Claims end on elimination and invalidate the cache
 * when they change within a prep. `second` = the other live
 * bond (core or add-on) with the most owned members whose next threshold is within reach (≥ 1 owned member).
 * `ps._botFocusId` keeps the focus across rounds. §35.62: an accepted advisor plan's primary core bond (its highest
 * priority) is the focus, owned members or not: the plan's direction leads legacy's procurement instead of competing with
 * it at +6..+30 per member.
 */
export function bondPlan(m, ps, owned = ownedBonds(m, ps)) {
  const mates = teammateBonds(m, ps);
  // [ASSUMED] Reconsider the focus when a teammate's public main changes, including within the same prep.
  const reservations = [...mates].sort().join();
  const planMain = (advisorPlan(m, ps)?.bonds || []).slice().sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .map((b) => b.id).find((id) => m.gd.bond(id)?.isCore && !m.gd.modeInactiveBonds.has(id)) ?? null;
  const key = `${m.round}|${ps.shop.level}|${[...owned.counts.entries()].map(([k, v]) => k + v).join()}|${reservations}|${planMain}`;
  if (ps._botFocus && ps._botFocus.key === key) return ps._botFocus;
  const prev = ps._botFocusId ?? null;
  let focus = null;
  let bestS = 0;
  const pool = bondPoolStats(m, ps, owned);
  for (const id of m.gd.bondIds) {
    const b = m.gd.bond(id);
    if (!b || !b.isCore || m.gd.modeInactiveBonds.has(id)) continue;
    const k = owned.counts.get(id) || 0;
    if (!k) continue;
    const s = k * 10 + Math.min(4, pool.reach.get(id) || 0) + Math.min(6, (ps.layers[id] || 0) / 10)
      // [ASSUMED] A public teammate claim outweighs commitment plus one member, but not an established large core.
      + (id === prev ? (k >= 3 ? CORE_LOCK : 6) : 0) - (mates.has(id) ? 30 : 0) + Math.min(0.9, (pool.supply.get(id) || 0) / 100);
    if (s > bestS) { bestS = s; focus = id; }
  }
  if (planMain) focus = planMain;
  let second = null;
  let bestK = 0;
  for (const id of m.gd.bondIds) {
    if (id === focus || m.gd.modeInactiveBonds.has(id)) continue;
    const b = m.gd.bond(id);
    if (!b || b.thresholdTemplate === 'count_threshold_downward' || !Array.isArray(b.thresholds) || !b.thresholds.length) continue;
    const k = owned.counts.get(id) || 0;
    if (!k) continue;
    const next = b.thresholds.find((t) => t > k);
    const s = k * 10 + (next != null && next - k <= 1 ? 5 : 0) + (b.isCore ? 0 : 2);
    if (s > bestK) { bestK = s; second = id; }
  }
  if (focus) ps._botFocusId = focus;
  ps._botFocus = { key, focus, second };
  return ps._botFocus;
}

/**
 * §35.63 layer trade: buy an operator whose 获得时 trait adds layers to every bond it has (SERVER_GAIN
 * SERVER_ADD_BOND_CHESS_ALL: 野鬃 / 角峰 / 艾丝黛尔 / 深靛 +2, 雪猎 / 灵知 +5, 忍冬 +6, 星熊 / 锏 +8) when it carries the focus or
 * an active bond, and sell it again unless it starts a pair, fills the board or makes the lineup. The community stacks this way: 「买卖
 * 灵知／野鬃／忍冬／角峰／雪猎」 doubles their stacking under 投资人 (BV1qkDsBtEER pinned; cv47352364; handoff/round51
 * RESEARCH §3.3). [ASSUMED] From R4, outside banking bands, and only when layers per net fund (price − the 1 refund) ×
 * the bonds it reaches is at least TRADE_MIN. Measured on 终极 with the other §35.63 rules (seeds 1–100): see history.
 */
const TRADE_MIN = 3;
const TRADE_FROM = 4;
function gainLayers(gd, c) {
  let n = 0;
  for (const gid of c.garrisonIds || []) {
    const g = gd.garrison(gid);
    if (g && g.eventType === 'SERVER_GAIN' && g.effectKey === 'SERVER_ADD_BOND_CHESS_ALL') n += Number(g.bb?.count) || 0;
  }
  return n;
}
function tradeOnce(m, ps, ctxOf) {
  if (m.round < TRADE_FROM || m.gd.leftoverKeptBands.includes(ps.bandId) || freeSlot(ps.hand) < 0) return false;
  const gd = ps.gd || m.gd;
  // the buy loop's context is built only when the shop shows an affordable layer unit (it runs every loop step)
  if (!ps.shop.slots.some((sl) => sl && !sl.sold && sl.kind === 'chess' && ps.priceOf(sl) <= ps.funds && gainLayers(gd, gd.chess(sl.id) || {}))) return false;
  const ctx = ctxOf();
  const active = new Set(Object.entries(ps.bonds).filter(([, b]) => b && b.active).map(([id]) => id));
  if (ctx.focus) active.add(ctx.focus);
  let best = -1;
  let bestV = 0;
  ps.shop.slots.forEach((sl, i) => {
    if (!sl || sl.sold || sl.kind !== 'chess') return;
    const price = ps.priceOf(sl);
    const c = price <= ps.funds ? gd.chess(sl.id) : null;
    const layers = c ? gainLayers(gd, c) : 0;
    const n = layers ? (c.bonds || []).filter((b) => active.has(b)).length : 0;
    const v = (layers * n) / Math.max(1, price - 1);
    if (n && v > bestV) { bestV = v; best = i; }
  });
  if (best < 0 || bestV < TRADE_MIN) return false;
  const before = new Set(ps.allChess().map((p) => p.uid));
  const keep = (ctx.copies.get(gd.baseIdOf(ps.shop.slots[best].id)) || 0) >= 1 || ps.allChess().length < ps.deployCap;
  if (!buyOffer(m, ps, best)) return false;
  const fresh = keep ? null : ps.allChess().find((p) => !before.has(p.uid));
  // a unit the lineup takes stays (the buy loop would have bought it anyway)
  if (fresh && !gd.isGolden(fresh.id) && !chooseLineup(m, ps, context(m, ps)).set.includes(fresh)) tryDo(() => ps.sell(fresh.uid));
  return true;
}

/**
 * §35.63: the focus core bond (bondPlan) between 2 owned members and its top threshold (6; 阿戈尔 5), when buys and
 * refreshes still build toward it (null otherwise). Measured on 终极 bots: boards owning 6 members of one core at R11
 * went from 2/18 to 11/19, co-op seats alive at the Final Assault rose (handoff/round51 cycle 3, EXP_CORE).
 */
function coreGap(m, focus, owned) {
  const bond = focus ? m.gd.bond(focus) : null;
  const th = bond && bond.isCore && Array.isArray(bond.thresholds) && bond.thresholds.length ? bond.thresholds : null;
  const k = owned.counts.get(focus) || 0;
  return th && k >= 2 && k < th[th.length - 1] ? { k, top: th[th.length - 1] } : null;
}

/** Copies a merge takes (3; 风丸 2). */
const mergeNeed = (m, base) => m.gd.mergeCount(base) || 3;


/**
 * Bases worth merging ("keepers"): the deployed operators, the owned members of the focus / second bond, and owned
 * chess of a tier ≥ shop level − 1. A pair of anything else only clutters the bench and is sold later at a loss
 * (every sale returns 1).
 */
function keeperBases(m, ps, plan) {
  const out = new Set((advisorPlan(m, ps)?.keep || []).filter(id => !m.gd.isGolden(id)));
  for (const p of ps.board.values()) if (p.kind === 'chess') out.add(m.gd.baseIdOf(p.id));
  for (const p of ps.allChess()) {
    const c = chessRec(m, p.id, ps);
    if (!c) continue;
    const bonds = c.bonds || [];
    if ((plan.focus && bonds.includes(plan.focus)) || (plan.second && bonds.includes(plan.second)) || c.tier >= ps.shop.level - 1) out.add(m.gd.baseIdOf(p.id));
  }
  return out;
}

/** Role census of the owned chess. */
function roles(m, ps) {
  const r = { blockers: 0, antiAir: 0, healers: 0, total: 0 };
  for (const p of ps.allChess()) {
    const c = chessRec(m, p.id, ps);
    if (!c) continue;
    r.total++;
    if (isBlocker(c)) r.blockers++;
    if (hitsFly(c)) r.antiAir++;
    if (isHealer(c)) r.healers++;
  }
  return r;
}

/**
 * Bond value of adding chess `c` to what is owned (owned counts exclude it). `second`: the second bond (bondPlan);
 * once the focus has 3 owned members a member of another core bond is worth less unless it reaches a threshold (the
 * deploy cap holds about 6 members of one core bond + 2 others).
 */
function bondValue(m, c, owned, focus, second = null) {
  let v = 0;
  const committed = focus && (owned.counts.get(focus) || 0) >= 3;
  for (const b of (c && c.bonds) || []) {
    const bond = m.gd.bond(b);
    if (!bond || m.gd.modeInactiveBonds.has(b)) continue;
    const n = owned.counts.get(b) || 0;
    const th = Array.isArray(bond.thresholds) && bond.thresholds.length ? bond.thresholds : [bond.activeCount || 2];
    const w = bond.isCore ? 1.4 : 1;
    v += (2 + n * 2) * w;
    const hits = th.includes(n + 1);
    if (hits) v += 10 * w;
    else if (th.some((t) => t > n + 1 && t - (n + 1) <= 1)) v += 3 * w;
    if (bond.thresholdTemplate === 'count_threshold_downward') v -= n > 0 ? 12 : 0; // 独行 breaks with a second member
    if (b === focus) v += 10 + (bond.isCore && n >= 2 && n < th[th.length - 1] ? CORE_MEMBER : 0);
    else if (b === second) v += 4;
    else if (committed && bond.isCore && !hits) v -= 4;
  }
  return v;
}

/**
 * Power of a chess record. Base stats barely grow with the tier (research 03: T1 E1 Lv55 … T6 E2 Lv1); higher tiers
 * bring better skills and talents, elites (精锐) +25 % stats and skill level 7 — so the tier weight is modest and the
 * elite weight large.
 */
function power(c) {
  if (!c) return 0;
  const p = TIER_POWER[Math.max(1, Math.min(6, c.tier || 1))];
  return c.isGolden ? p * 1.9 : p;
}

/**
 * 特质 census of a chess (cached per match): recurring layer traits (every prep / refresh), one-shot layer traits
 * (获得时) and economy traits (funds / free refreshes). Humans build around the layer engines — so does the bot.
 */
function traitsOf(m, c) {
  const cache = m._botTraits || (m._botTraits = new Map());
  if (cache.has(c.chessId)) return cache.get(c.chessId);
  const t = { recurring: 0, gain: 0, econ: 0 };
  for (const gid of Array.isArray(c.garrisonIds) ? c.garrisonIds : []) {
    const g = m.gd.garrison(gid);
    if (!g || typeof g.effectKey !== 'string') continue;
    if (LAYER_TRAIT_RE.test(g.effectKey) && RECURRING_TRAIT_EVENTS.has(g.eventType)) t.recurring++;
    else if (LAYER_TRAIT_RE.test(g.effectKey) && g.eventType === 'SERVER_GAIN') t.gain++;
    else if (ECON_TRAIT_RE.test(g.effectKey) && g.eventType !== 'IN_BATTLE') t.econ++;
  }
  cache.set(c.chessId, t);
  return t;
}

/** Stand-alone value of an owned piece (no bond context): power, items, role fit, layer engines. */
function unitBase(m, piece, ctx) {
  const c = chessRec(m, piece.id, ctx.ps);
  if (!c) return 0;
  let v = power(c) + (piece.items ? piece.items.length * 5 : 0) + PLAN_UNIT_SHARE * planUnitWeight(m, ctx.ps, piece.id);
  if (m.round <= 11) v += traitsOf(m, c).recurring * 4;
  if (c.attackKind === 'none' && !isHealer(c)) v -= 6;
  if (ctx.fly > 0 && hitsFly(c)) v += 2;
  if (ctx.model && !isHealer(c)) v += ARMOR_WEIGHT * (armorFit(ctx.model, c) - 0.6);
  return v;
}

/** Value of an owned piece for bench / sell decisions (its bonds counted against the other owned chess). */
function pieceValue(m, ps, piece, ctx) {
  const c = chessRec(m, piece.id, ps);
  if (!c) return 0;
  return unitBase(m, piece, ctx) + bondValue(m, c, ownedBonds(m, ps, piece.uid), ctx.focus, ctx.second) * 0.8;
}

/**
 * Score of a deployed set: unit values + the bonds it activates (exact tiers via bondsMeta.computeBonds, hand
 * members still count for BOARD_AND_DECK bonds) + composition (blockers, anti-air when the wave flies, ≤ 2 healers).
 */
function lineupScore(m, ps, set, ctx, handSlots = countFree(ps.hand)) {
  const gd = ps?.gd || m.gd;
  const board = new Map();
  set.forEach((p, i) => board.set(`x${i}`, p));
  const inSet = new Set(set.map((p) => p.uid));
  // arrangeSteps withdraws unchosen board chess before deployment, or sells them when the hand has no room.
  const withdrawn = [...ps.board.values()].filter((p) => p.kind === 'chess' && !inSet.has(p.uid)).slice(0, handSlots);
  const hand = [...ps.hand.filter((p) => p && !inSet.has(p.uid)), ...withdrawn];
  const bonds = computeBonds(gd, { board, hand, layers: ps.layers, bondCountBonus: ps.bondCountBonus });
  let v = 0;
  for (const p of set) v += unitBase(m, p, ctx);
  for (const [id, b] of Object.entries(bonds)) {
    // every deployed focus member counts on the way to the next threshold (a swap alone never reaches the 6-member tier)
    if (id === ctx.focus) {
      const bond = gd.bond(id);
      const top = bond && Array.isArray(bond.thresholds) && bond.thresholds.length ? bond.thresholds[bond.thresholds.length - 1] : 3;
      v += FOCUS_MEMBER * Math.min(b.count || 0, top);
    }
    if (!b.tier) continue;
    const bond = gd.bond(id);
    const w = bond && bond.isCore ? 14 : 9;
    v += b.tier * w + Math.min(12, (b.layers || 0) * 0.1) + (id === ctx.focus ? 6 : 0) + (bond?.isCore && b.tier >= 2 ? CORE_TOP_TIER : 0);
  }
  let blockers = 0;
  let air = 0;
  let healers = 0;
  for (const p of set) { const c = chessRec(m, p.id, ps); if (isBlocker(c)) blockers++; if (hitsFly(c)) air++; if (isHealer(c)) healers++; }
  v -= Math.max(0, Math.min(2, ctx.roles.blockers) - blockers) * 15;
  if (ctx.fly > 0 && ctx.roles.antiAir > 0 && air === 0) v -= 12;
  v -= Math.max(0, healers - 2) * 10;
  if (m.round >= HEAL_FROM) v += Math.min(healers, 1) * HEAL_FIRST + (healers >= 2 && m.round >= 9 ? HEAL_SECOND : 0);
  return v;
}

/**
 * Best deployable set of at most `cap` owned chess: greedy seed + swap hill-climbing on lineupScore. §35.62: one swap at
 * a time cannot carry a core bond from 3 to 6 deployed members (every intermediate swap scores lower), so each core bond
 * with enough distinct owned members for a threshold above 3 also seeds a climb from that full threshold; the best
 * climb wins.
 */
function chooseLineup(m, ps, ctx) {
  const gd = ps?.gd || m.gd;
  const all = ps.allChess();
  const cap = Math.min(ps.deployCap, all.length);
  const value = new Map(all.map((p) => [p.uid, pieceValue(m, ps, p, ctx)]));
  const seed = all.slice().sort((a, b) => value.get(b.uid) - value.get(a.uid) || a.uid - b.uid);
  let best = climbLineup(m, ps, ctx, seed.slice(0, cap), seed.slice(cap));
  for (const id of gd.bondIds) {
    const bond = gd.bond(id);
    if (!bond || !bond.isCore || gd.modeInactiveBonds.has(id) || !Array.isArray(bond.thresholds)) continue;
    const members = [];
    const bases = new Set();
    for (const p of seed) {
      const base = gd.baseIdOf(p.id);
      if (bases.has(base) || !(chessRec(m, p.id, ps)?.bonds || []).includes(id)) continue;
      bases.add(base);
      members.push(p);
    }
    const t = bond.thresholds.filter((x) => x > 3 && x <= Math.min(cap, members.length)).pop();
    if (!t) continue;
    const core = new Set(members.slice(0, t).map((p) => p.uid));
    const start = members.slice(0, t).concat(seed.filter((p) => !core.has(p.uid))).slice(0, cap);
    const used = new Set(start.map((p) => p.uid));
    const run = climbLineup(m, ps, ctx, start, seed.filter((p) => !used.has(p.uid)));
    if (run.score > best.score + 0.5) best = run;
  }
  return best;
}

function climbLineup(m, ps, ctx, set0, bench0) {
  let set = set0.slice();
  let bench = bench0.slice();
  let score = lineupScore(m, ps, set, ctx);
  // identical pieces (same chess, same items — a bond can hang on an item pair) score alike: only the first is tried
  const sig = (p) => `${p.id}|${(p.items || []).map((it) => it.id).sort().join('+')}`;
  for (let iter = 0; iter < 12 && bench.length; iter++) {
    let best = null;
    const tried = new Set();
    for (let j = 0; j < bench.length; j++) {
      const sj = sig(bench[j]);
      if (tried.has(sj)) continue;
      tried.add(sj);
      for (let i = 0; i < set.length; i++) {
        if (sig(set[i]) === sj) continue;
        const trial = set.slice();
        trial[i] = bench[j];
        const s = lineupScore(m, ps, trial, ctx);
        if (s > score + 0.5 && (!best || s > best.s || (s === best.s && (i < best.i || (i === best.i && j < best.j))))) best = { i, j, s };
      }
    }
    if (!best) break;
    const out = set[best.i];
    set[best.i] = bench[best.j];
    bench[best.j] = out;
    score = best.s;
  }
  return { set, bench, score };
}

/** buyScore with a fresh context (tests). */
export function buyScoreOf(m, ps, id, policy = null) {
  return buyScore(m, ps, id, context(m, ps, policy));
}

/** Shop / reward score of acquiring one copy of chess `id` (0 = not worth it). */
function buyScore(m, ps, id, ctx) {
  const gd = ps?.gd || m.gd;
  const c = chessRec(m, id, ps);
  if (!c) return 0;
  let s = power(c) * 0.6 + planUnitWeight(m, ps, id, true);
  const tr = traitsOf(m, c);
  if (m.round <= 11) s += tr.recurring * 3 + tr.gain * 2 + tr.econ * (m.round <= 7 ? 2 : 0);
  const base = gd.baseIdOf(id);
  if (!c.isGolden) {
    const copies = ctx.copies.get(base) || 0;
    if (copies > 0) {
      // merge progress: an elite plus the merge's free next-tier reward (MERGE_HIT) — for any pair; a new pair of a
      // non-keeper only while the bench has room for it (cheap tiers: the third copy is hunted with refreshes)
      const keep = ctx.keep.has(base);
      if (copies + 1 >= mergeNeed(m, base)) s += keep ? 40 : 30;
      else s += keep ? 14 : ctx.pairs < MAX_PAIRS && c.tier <= 3 ? 6 : 1;
    }
  }
  if (!ctx.owned.bases.has(base)) s += bondValue(m, c, ctx.owned, ctx.focus, ctx.second);
  // role needs
  if (isBlocker(c) && ctx.roles.blockers < 2) s += 10;
  if (hitsFly(c) && ctx.fly > 0 && ctx.roles.antiAir < 2) s += 8;
  if (isHealer(c)) s += ctx.roles.healers === 0 && m.round >= 3 ? 14 : ctx.roles.healers >= 2 ? -14 : ctx.roles.healers === 1 && m.round >= 8 ? 4 : -3;
  if (c.attackKind === 'none' && !isHealer(c)) s -= 4;
  if (ctx.model && !isHealer(c)) s += ARMOR_WEIGHT * 0.6 * (armorFit(ctx.model, c) - 0.6);
  // the player's own 自选 piece (a slotted slot: its composed record carries diyFor) — AI 托管 of a human with picks
  if (c.diyFor) s += DIY_PIECE_BONUS;
  // [ASSUMED] A soft cooperation weight, not an official rule or a reserved card: leave shared chess to the living
  // teammates whose opening strategy or main core bond needs its faction (teammateBonds) — 18 for tiers 5–6 (PR #407),
  // 12 for tiers 1–4 (#121: a 歌利亚 bot hoarded a 潘格尼尼 player's low-tier <拉特兰>) — unless the own opening strategy
  // needs that bond too. Humans and bots count equally; one penalty however many teammates; an own merge (MERGE_HIT)
  // or a missing blocker / healer still outweighs it.
  if (!c.isGolden && !c.diyFor && m.pool.has(base) && c.bonds.some((b) => ctx.mateBonds?.has(b))) s -= c.tier >= 5 ? 18 : 12;
  return s + (ctx.policy?.buyBonus(m, ps, id, ctx) || 0);
}

// ---------------------------------------------------------------------------------------------------
// field model: where the round's enemies walk / fly over the own board, and an exposure model of a layout

const inRect = (r, c) => r >= FIELD.r0 && r <= FIELD.r1 && c >= 0 && c <= FIELD.c1;

/** Integer tiles along a polyline of [row, col] points (inclusive, consecutive duplicates removed). */
function traceLine(points) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [r0, c0] = points[i];
    const [r1, c1] = points[i + 1];
    const n = Math.max(1, Math.abs(r1 - r0), Math.abs(c1 - c0));
    for (let k = 0; k <= n; k++) {
      const t = [Math.round(r0 + ((r1 - r0) * k) / n), Math.round(c0 + ((c1 - c0) * k) / n)];
      const last = out[out.length - 1];
      if (!last || last[0] !== t[0] || last[1] !== t[1]) out.push(t);
    }
  }
  return out;
}

/** Boss field → own board: board.js boardTileOf (board rows 9–12 are boss rows 2–5; the right side mirrored). */
const BOSS_MID_COL = 10;
/** Dwell (s) the planner assumes on a leader's first own tiles (several leaders fight from their spawn point). */
const BOSS_DWELL = 30;
/** A leader is modeled as LEADER_WEIGHT enemies of LEADER_HP each (its route draws the damage dealers). */
const LEADER_WEIGHT = 10;
const LEADER_HP = 40000;

/** The boss-round wave of a player's group and its side ('L' | 'R'), or null (Match.bossGroupOf). */
function bossWaveOf(m, ps) {
  const g = typeof m.bossGroupOf === 'function' ? m.bossGroupOf(ps) : null;
  return g && g.wave ? { wave: g.wave, side: g.side } : null;
}

/**
 * The round's routes over the own board (cached per round): [{ n, fly (air units: flyers, and the 近地悬浮 HOVER_KEYS
 * on their ground path), tiles: ['r,c'…] (gate → objective, own region only, objective tile excluded), tileTime (s per
 * tile), hp }], a tile → [[route, index]] index, and the
 * aggregated ground flow per tile. Built from the wave preview (spawn counts per route, enemy HP / speed with the
 * round's multipliers). Boss rounds (pass `ps`): the player's boss-field template mapped onto the own board (rows −7,
 * the right player's half mirrored; only the routes that end on the player's half), the leader weighted heavily with
 * a dwell on its first tiles so damage dealers reach it; missing data falls back to every ground path from the own
 * gates.
 */
export function fieldModel(m, ps = null) {
  const boss = m.wave ? null : bossWaveOf(m, ps);
  const wave = m.wave || (boss && boss.wave);
  const cacheKey = `${m.round}|${m.stageId}|${wave ? wave.templateId : 'boss'}|${boss ? boss.side : ''}`;
  if (m._botPath && m._botPath.key === cacheKey) return m._botPath;
  const gd = ps?.gd || m.gd;
  const st = m.stage;
  const gpaths = (st && (st.groundPathsWithDevices || st.groundPaths)) || {};
  const routesOut = [];
  const toBoard = boss
    ? ([r, c]) => boardTileOf(boss.side === 'R' ? 'bossR' : 'bossL', r, c)
    : (p) => p;
  const pushRoute = (tilesRC, n, fly, hp, speed, dwell = 0) => {
    const own = tilesRC.map(toBoard).filter(([r, c]) => inRect(r, c)).map(([r, c]) => tileKey(r, c));
    if (own.length > 1) own.pop(); // the objective / last tile: an enemy there has already leaked
    if (!own.length) return;
    const tileTime = Math.max(0.4, Math.min(6, 1 / Math.max(0.05, speed * 0.5)));
    routesOut.push({ n, fly, tiles: own, tileTime, hp: Math.max(100, hp), dwell });
  };
  const routes = wave && Array.isArray(wave.routes) ? wave.routes : [];
  const spawns = wave && Array.isArray(wave.spawns) ? wave.spawns : [];
  // boss pair templates route to both goals: keep the routes ending on this player's half (mirrored for 'R')
  const ownRoute = (rt) => {
    if (!boss || !Array.isArray(rt.end)) return true;
    const endCol = rt.end[1];
    return boss.side === 'R' ? endCol > BOSS_MID_COL : endCol <= BOSS_MID_COL;
  };
  const mirrorRoute = (rt) => {
    // the right player fights the mirror image of the routes that end on the left goal (its own copy of the leader)
    if (!boss || boss.side !== 'R' || !Array.isArray(rt.end) || rt.end[1] > BOSS_MID_COL) return rt;
    const mc = ([r, c]) => [r, BOSS_MIRROR_COL - c];
    return { ...rt, start: mc(rt.start), end: mc(rt.end), checkpoints: Array.isArray(rt.checkpoints) ? rt.checkpoints.map(mc) : [] };
  };
  const foes = new Map(); // DEF|RES → HP share of the round's enemies (effDps)
  if (routes.length && spawns.length) {
    const per = new Map();
    for (const s of spawns) {
      const e = gd.enemy(s.enemyKey);
      const n = Math.max(1, s.count || 1);
      const isLeader = s.tag === 'boss';
      if (s.tag === 'part') continue;
      if (e && e.stats) {
        const k = `${e.stats.def || 0}|${e.stats.res || 0}`;
        foes.set(k, (foes.get(k) || 0) + (isLeader ? LEADER_HP * LEADER_WEIGHT : (e.stats.maxHp || 1000) * n));
      }
      // the leader counts like LEADER_WEIGHT tough enemies: its huge pool makes damage on it worth a lot everywhere
      const hp = isLeader ? LEADER_HP : ((e && e.stats && e.stats.maxHp) || 1000) * ((s.mods && s.mods.hpMul) || 1);
      const spd = ((e && e.stats && e.stats.moveSpeed) || 1) * ((s.mods && s.mods.speedMul) || 1);
      const air = HOVER.has(s.enemyKey);
      const key = `${s.routeIndex}|${isLeader ? 'boss' : ''}|${air ? 'air' : ''}`;
      const a = per.get(key) || { ri: s.routeIndex, boss: isLeader, air, n: 0, hp: 0, spd: 0 };
      a.n += isLeader ? LEADER_WEIGHT : n; a.hp += hp * n; a.spd += spd * n;
      per.set(key, a);
    }
    for (const a of per.values()) {
      let rt = routes[a.ri];
      if (!rt || !Array.isArray(rt.start) || !Array.isArray(rt.end)) continue;
      if (boss && !a.boss && !ownRoute(rt)) continue;
      // in a pair each player fights its own copy of the leader (spawned on its side)
      rt = mirrorRoute(rt);
      const cnt = a.boss ? 1 : a.n;
      const dwell = a.boss ? BOSS_DWELL : 0;
      if (rt.motion === 'FLY') {
        pushRoute(traceLine([rt.start, ...(Array.isArray(rt.checkpoints) ? rt.checkpoints : []), rt.end]), a.n, true, a.hp / cnt, a.spd / cnt, dwell);
      } else {
        const key = `${rt.start[0]},${rt.start[1]}->${rt.end[0]},${rt.end[1]}`;
        const path = Array.isArray(gpaths[key]) ? gpaths[key] : traceLine([rt.start, ...(boss && Array.isArray(rt.checkpoints) ? rt.checkpoints : []), rt.end]);
        pushRoute(path, a.n, a.air, a.hp / cnt, a.spd / cnt, dwell); // a hovering enemy: ground tiles, air unit
      }
    }
  }
  if (!routesOut.some((r) => !r.fly)) {
    for (const [k, arr] of Object.entries(gpaths)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      const [sr, sc] = String(k).split('->')[0].split(',').map(Number);
      if (!(sr >= FIELD.r0 && sr <= FIELD.r1 && sc <= FIELD.c1)) continue;
      // stage ground paths are in normal-field coordinates: no boss mapping
      const own = arr.filter(([r, c]) => inRect(r, c)).map(([r, c]) => tileKey(r, c));
      if (own.length > 1) own.pop();
      if (own.length) routesOut.push({ n: 3, fly: false, tiles: own, tileTime: 2, hp: 3000, dwell: 0 });
    }
  }
  const index = new Map();
  const ground = new Map();
  routesOut.forEach((rt, ri) => {
    rt.tiles.forEach((k, i) => {
      if (!index.has(k)) index.set(k, []);
      index.get(k).push([ri, i]);
      if (!rt.fly) {
        const e = ground.get(k) || { flow: 0, prog: 0 };
        e.flow += rt.n;
        e.prog = Math.max(e.prog, rt.tiles.length > 1 ? i / (rt.tiles.length - 1) : 1);
        ground.set(k, e);
      }
    });
  });
  const flyTotal = routesOut.filter((r) => r.fly).reduce((s, r) => s + r.n, 0);
  let wsum = 0;
  for (const w of foes.values()) wsum += w;
  const armor = [...foes.entries()].map(([k, w]) => { const [def, res] = k.split('|').map(Number); return { def, res, w: w / wsum }; });
  m._botPath = { key: cacheKey, routes: routesOut, index, ground, flyTotal, airflow: airflowOf(st, toBoard, boss && boss.side === 'R'), armor, dps: new Map() };
  return m._botPath;
}

/**
 * 气流 (act2 m01 blowers, sim content/devices.js): own-board tile → { dir, bb } for every tile a (data-)active blower
 * blows over, mapped like the routes (boss rounds: rows −7, the right side mirrored — RIGHT ↔ LEFT). An operator on
 * such a tile facing WITH the flow gets ATK × (1 + blower_s_character[equal].atk), against it [opposite], across it
 * [vertical] (DESIGN §3, research 09 §1.1): the planner scales its DPS accordingly when it picks a direction.
 */
function airflowOf(st, toBoard, mirrored) {
  const out = new Map();
  for (const d of (st && Array.isArray(st.devices) ? st.devices : [])) {
    if (!d || d.role !== 'blower' || d.active === false || d.hidden) continue;
    const bb = (d.skill && d.skill.bb) || {};
    const dir = mirrored ? mirrorDir(normDir(d.dir, 'UP')) : normDir(d.dir, 'UP');
    for (const p of Array.isArray(d.rangeTiles) ? d.rangeTiles : []) {
      if (!Array.isArray(p)) continue;
      const [r, c] = toBoard(p);
      if (inRect(r, c)) out.set(tileKey(r, c), { dir, bb });
    }
  }
  return out;
}

/** ATK factor of an operator standing on `key` facing `dir` in the model's airflow (1 off the flow). */
export function airflowAtkMul(model, key, dir) {
  const f = model && model.airflow instanceof Map ? model.airflow.get(key) : null;
  if (!f) return 1;
  const rel = dir === f.dir ? 'equal' : dir === oppositeDir(f.dir) ? 'opposite' : 'vertical';
  const v = Number(f.bb[`blower_s_character[${rel}].atk`]);
  return Number.isFinite(v) ? Math.max(0, 1 + v) : 1;
}

/** Direction candidates of the planner, in preference order (ties keep the earlier one: RIGHT = toward the gates). */
export const PLAN_DIRS = Object.freeze(['RIGHT', 'UP', 'DOWN', 'LEFT']);

/** Board tile keys covered by a record's range grid standing on (r, c) facing `dir` (grid rotated, DESIGN §3). */
export function rangeTiles(rec, r, c, dir = 'RIGHT') {
  const grid = rec && Array.isArray(rec.rangeGrid) && rec.rangeGrid.length ? rec.rangeGrid : DEFAULT_MELEE_RANGE;
  return grid.map(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, dir); return tileKey(r + a, c + b); });
}

/**
 * Enemies an attack strikes at once, as a factor on a dealer's DPS (the exposure model gives every unit's DPS to each
 * enemy on a covered tile, so a single-target dealer is overrated in a crowd): 阵法术师 / 轰击术师 strike every enemy in
 * range (sim professions.js rangeAoe, community report E3 after 0.1.0 — the 阵法术师's skill-off pause is the 0.4 of a
 * non-attacker), splash and chain branches a few [ASSUMED values, botbench A/B in BALANCE.md].
 */
const CROWD = Object.freeze({ phalanx: 2, blastcaster: 2, splashcaster: 1.3, aoesniper: 1.3, bombarder: 1.3, chain: 1.4 });
const crowdOf = (rec) => CROWD[rec && rec.subProfessionId] ?? 1;

/** Damage per second of a record (attack / attack interval; healers and non-attackers 0). */
function dpsOf(rec) {
  const st = rec && rec.stats;
  if (!st || isHealer(rec)) return 0;
  const interval = Math.max(0.2, (st.bat || 1) * 100 / Math.max(ASPD_MIN, st.aspd || 100));
  const d = ((st.atk || 0) / interval) * crowdOf(rec);
  return rec.attackKind === 'none' ? d * 0.4 : d;
}

/** Damage per second of a record against one enemy's DEF / RES (one hit mitigated like the sim, attack.js mitigate). */
function dpsVs(rec, def, res) {
  const st = rec && rec.stats;
  if (!st || isHealer(rec)) return 0;
  const interval = Math.max(0.2, (st.bat || 1) * 100 / Math.max(ASPD_MIN, st.aspd || 100));
  const d = (mitigate(st.atk || 0, rec.dmgType === 'arts' ? 'arts' : 'phys', { def, res }) / interval) * crowdOf(rec);
  return rec.attackKind === 'none' ? d * 0.4 : d;
}

/**
 * The record a chess fights with for range purposes: its range grid replaced by the one it is deployed with under the
 * player's loadout — a passive 攻击范围扩大 skill, a module's range or 攻击距离 (shared/loadoutRecord.js attackRangeGrid:
 * what the server's summonRange, the deploy wheel and the card use since 0.1.1) — else the record itself. 信仰搅拌机 S3
 * is the exception: the planner uses that skill's own grid and does not grow it (§35.106). Cached per player and loadout.
 */
export function rangeRec(ps, rec) {
  if (!rec || !rec.chessId || typeof ps.loadoutFor !== 'function') return rec;
  const lo = ps.loadoutFor(rec);
  const key = `${rec.chessId}|${lo ? `${lo.skillIndex ?? lo.skill ?? ''}:${lo.moduleId ?? lo.module ?? ''}` : ''}`;
  const cache = ps._botRangeRecs || (ps._botRangeRecs = new Map());
  if (cache.has(key)) return cache.get(key);
  let out = rec;
  try {
    // 0.2.0 补位: a human's not-owned chess (AI 托管) is deployed as its stand-in — that body's range
    const body = typeof ps.fieldRecord === 'function' ? ps.fieldRecord(rec) || rec : rec;
    const resolved = loadoutRecord(body, resolveRecordLoadout(body, lo));
    let g = attackRangeGrid(resolved);
    // 信仰搅拌机 S3 退休前布道 (skchr_rmixer_3). The skill text is 「攻击范围扩大」 without 「被动效果：」, so attackRangeGrid
    // (the deploy overlay, the card and summonRange) keeps the base line. PRTS 备注: 此技能的攻击范围不受「攻击距离」属性影响
    // — SPT-Y's +1 does not grow it (the kit's targeting.noRangeExtend). [ASSUMED] The skill is ammo and is not up for
    // the whole fight; scoring and facing still use this grid for the deployment (#31).
    const sk = resolved && resolved.skill;
    if (sk && sk.skillId === 'skchr_rmixer_3' && Array.isArray(sk.rangeGrid) && sk.rangeGrid.length) g = sk.rangeGrid;
    if (Array.isArray(g) && g.length && JSON.stringify(g) !== JSON.stringify(rec.rangeGrid)) out = Object.freeze({ ...rec, rangeGrid: g });
  } catch { out = rec; }
  cache.set(key, out);
  return out;
}

/**
 * DPS of a record against the round's enemies: dpsVs averaged over their DEF / RES weighted by HP (the field model's
 * `armor`; cached per round) — physical dealers lose most of their damage on 重甲 waves, arts dealers on high-RES ones.
 * Without a model (or enemies) the raw dpsOf.
 */
export function effDps(model, rec) {
  if (!rec) return 0;
  if (!model || !Array.isArray(model.armor) || !model.armor.length) return dpsOf(rec);
  // (a 自选 record — one DIY slot id, each player's own operator — is cached per operator and skill)
  const id = rec.diyFor ? `${rec.chessId}@${rec.charId}#${rec.skill?.index ?? ''}` : rec.chessId || rec.tokenId || rec.id || rec.name;
  const cache = model.dps instanceof Map ? model.dps : null;
  if (cache && cache.has(id)) return cache.get(id);
  let v = 0;
  for (const a of model.armor) v += a.w * dpsVs(rec, a.def, a.res);
  if (cache) cache.set(id, v);
  return v;
}

/** Share of a dealer's raw DPS that gets through the round's armour (1 for healers / no enemies). */
function armorFit(model, rec) {
  const raw = dpsOf(rec);
  return raw > 0 ? effDps(model, rec) / raw : 1;
}

/** Tunables of the exposure model (tuned offline against the real simulation, tools/matchrun.mjs sweeps). */
export const LAYOUT_PARAMS = Object.freeze({ hold: 4, kill: 1.5, secondHold: 0.5, healHold: 0.5, roadPenalty: 0.15, spread: 99 });

/**
 * Exposure model of a layout: every enemy of route ρ spends tileTime on each tile of its route (plus the hold time
 * of blockers standing on it: hold × blockCnt, later blockers on the same route secondHold ×, healer-covered
 * blockers (1 + healHold) ×) and takes the DPS of every unit whose range covers that tile (flyers: anti-air only).
 * Value = Σρ n × (1 − e^(−exposure / (kill × hp))) — the expected enemies killed.
 */
class Layout {
  constructor(model, params) {
    this.model = model;
    this.p = params;
    this.units = []; // { rec, key, dps, air, ground, block, heal, cover: Set }
  }

  value() {
    const { routes } = this.model;
    const p = this.p;
    const cover = new Map(); // key → { g: dps on ground, a: dps on air }
    const healCover = new Map();
    for (const u of this.units) {
      for (const k of u.cover) {
        const e = cover.get(k) || { g: 0, a: 0 };
        if (u.ground) e.g += u.dps;
        if (u.air) e.a += u.dps;
        cover.set(k, e);
        if (u.heal) healCover.set(k, (healCover.get(k) || 0) + 1);
      }
    }
    const blockAt = new Map();
    for (const u of this.units) if (u.block > 0 && this.model.ground.has(u.key)) blockAt.set(u.key, (blockAt.get(u.key) || 0) + u.block);
    let total = 0;
    for (const rt of routes) {
      let exp = 0;
      let lastBlock = -Infinity;
      for (let i = 0; i < rt.tiles.length; i++) {
        const k = rt.tiles[i];
        let t = rt.tileTime + (i < 2 && rt.dwell ? rt.dwell : 0);
        if (!rt.fly && blockAt.has(k)) {
          // a blocker right behind another one mostly holds what slipped past; a separate line holds again
          const fresh = i - lastBlock >= p.spread;
          t += p.hold * blockAt.get(k) * (fresh ? 1 : p.secondHold) * (1 + p.healHold * Math.min(2, healCover.get(k) || 0));
          lastBlock = i;
        }
        const c = cover.get(k);
        if (c) exp += t * (rt.fly ? c.a : c.g);
      }
      total += rt.n * (1 - Math.exp(-exp / (p.kill * rt.hp)));
    }
    // ranged units standing on a road block and get hit: a small penalty per road tile they occupy
    for (const u of this.units) if (!u.block && this.model.ground.has(u.key)) total -= p.roadPenalty * this.model.ground.get(u.key).flow;
    return total;
  }
}

function unitOf(rec, key, r, c, dir = 'RIGHT', model = null) {
  const block = isBlocker(rec) ? Math.max(1, rec.stats?.blockCnt ?? 1) : 0;
  const atkMul = airflowAtkMul(model, key, dir);
  return {
    rec, key, dir, dps: effDps(model, rec) * atkMul, atkMul, air: hitsFly(rec), ground: rec.attackKind !== 'heal' && !isHealer(rec),
    block, heal: isHealer(rec), cover: new Set(rangeTiles(rec, r, c, dir)),
  };
}

/** A layout plan: Map uid → tile key, plus `dirs`: Map uid → direction (UP|RIGHT|DOWN|LEFT). */
export class LayoutPlan extends Map {
  constructor(entries) { super(entries); this.dirs = new Map(); }
  /** The planned direction of a piece (RIGHT when unplanned). */
  dirOf(uid) { return this.dirs.get(uid) ?? 'RIGHT'; }
}

/** Every incoming ground route needs one ally covering both this tile and its preceding blocking contact (#452).
 * Different routes may use different allies; healing never counts as damage support. */
function supportedContact(model, units, key, self = null) {
  return (model.index.get(key) || []).every(([ri, i]) => {
    const rt = model.routes[ri];
    return rt.fly || units.some((ally) => ally !== self && ally.ground && ally.dps > 0
      && ally.cover.has(key) && ally.cover.has(rt.tiles[Math.max(0, i - 1)]));
  });
}

/**
 * Plan tiles and directions for `pieces` (chess or token pieces with `id`): blockers first, then damage dealers by
 * DPS, then healers and the rest; each takes the legal free (tile, direction) with the best marginal layout value
 * (directions in PLAN_DIRS order, a direction whose rotated range equals an earlier one's is skipped; one rng draw per
 * tile breaks ties between tiles). Returns a LayoutPlan (Map uid → key, `.dirs` uid → dir).
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 */
export function planLayout(m, ps, pieces, params = LAYOUT_PARAMS, opts = {}) {
  return runSteps(planLayoutSteps(m, ps, pieces, params, opts));
}

/** planLayout as a step generator: yields after each placed piece (Match slices a bot's prep, see botPrepBeginSteps). */
export function* planLayoutSteps(m, ps, pieces, params = LAYOUT_PARAMS, { occupied = new Set(), recOf = null } = {}) {
  const model = fieldModel(m, ps);
  const map = ps.deployMap();
  const pgd = ps.gd || m.gd;
  const rec = recOf || ((p) => (p.kind === 'token' ? pgd.token(p.id) : rangeRec(ps, pgd.chess(p.id))));
  const layout = new Layout(model, params);
  const rank = (p) => { const r = rec(p); return isBlocker(r) ? 0 : isHealer(r) ? 2 : 1; };
  // [ASSUMED] Boss rounds place wider healing ranges first (#315). The last arrangement still rehearses.
  const order = pieces.slice().sort((a, b) => rank(a) - rank(b) || dpsOf(rec(b)) - dpsOf(rec(a))
    || (!m.wave && isHealer(rec(a)) ? (rec(b)?.rangeGrid?.length || 0) - (rec(a)?.rangeGrid?.length || 0) : 0) || a.uid - b.uid);
  const taken = new Set(occupied);
  const out = new LayoutPlan();
  for (const p of order) {
    const r0 = rec(p);
    if (!r0) continue;
    let best = null;
    let bestV = -Infinity;
    // a "只能部署在召唤者攻击范围内" summon (伺夜's 狼群, 缪尔赛思's 流形): only the tiles of its owner's range
    const within = p.kind === 'token' && typeof ps.summonRange === 'function' ? ps.summonRange(p) : null;
    // and an outside-bound one (凯尔希·思衡托's 战术锚点): never a tile of its owner's range
    const without = p.kind === 'token' && typeof ps.summonExcluded === 'function' ? ps.summonExcluded(p) : null;
    // ground tiles for a MELEE blocker. placeClass 'all' on a MELEE record is a chess whose trait reads 「可以放置于远程位」
    // (歌蕾蒂娅, 崖心, 见行者, any module): it may stand on a 高台, and when one of those tiles covers the enemy road it is
    // planned there even with the ground free (owner 2026-10-04: the bot uses the 高台; 2026-10-05: every such chess).
    const cls = p.kind === 'token' ? positionClass(r0) : placeClass(ps, pgd.chess(p.id) || r0);
    const preferHigh = cls === 'all' && basePositionClass(r0) === 'melee';
    let bestHigh = null;
    let bestHighV = -Infinity;
    // a blocker whose range is its own tile only (range 0-1: 角峰, 古米, 泡泡, 折桠, 菲莱, 蛇屠箱, 塞雷娅, 余) neither blocks nor
    // hits anything off the enemy road — the official range "0-1" (excel range_table) is the one grid (0,0) — so a free road tile
    // comes first (the kill estimate saturates in a full layout and then cannot tell the tiles apart)
    const preferRoad = isBlocker(r0) && r0.rangeGrid?.length === 1 && r0.rangeGrid[0].every((v) => v === 0);
    let bestRoad = null;
    let bestRoadV = -Infinity;
    // [ASSUMED] A blocking medic prefers off-road tiles, then supported road tiles, with a legal fallback (#577/#315).
    const needsSupport = isHealer(r0) && (r0.stats?.blockCnt ?? 1) > 0;
    let bestSafe = null;
    let bestSafety = 0;
    let bestSafeV = -Infinity;
    let bestHealing = -Infinity;
    let bestNoise = -Infinity;
    const healed = new Set(layout.units.filter((u) => u.heal).flatMap((u) => [...u.cover]));
    for (const [r, c] of legalTiles(map, cls)) {
      const k = tileKey(r, c);
      if (taken.has(k) || (within && !within.has(k)) || (without && without.has(k))) continue;
      const noise = m.rngBots() * 1e-6;
      const safety = !needsSupport ? 0 : !model.ground.has(k) ? 2 : supportedContact(model, layout.units, k) ? 1 : 0;
      const seen = new Set();
      for (const dir of PLAN_DIRS) {
        const u = unitOf(r0, k, r, c, dir, model);
        // (the same covered tiles under a different airflow ATK factor are a different candidate)
        const sig = `${u.atkMul}|${[...u.cover].sort().join(' ')}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        layout.units.push(u);
        const value = layout.value();
        const v = value + noise + planPlacementWeight(m, ps, p.id, r, c, dir);
        layout.units.pop();
        if (v > bestV) { bestV = v; best = [k, r, c, dir]; }
        // [ASSUMED] On boss ties cover damage not already covered by a previously placed medic (#315).
        const healing = !m.wave ? layout.units.reduce((sum, ally) => sum
          + (u.cover.has(ally.key) && !healed.has(ally.key) ? ally.dps : 0), 0) : 0;
        const safeV = m.wave ? v : value;
        if (safety > 0 && (safety > bestSafety || (safety === bestSafety && (safeV > bestSafeV
          || (safeV === bestSafeV && (healing > bestHealing || (healing === bestHealing && noise > bestNoise))))))) {
          bestSafety = safety; bestSafeV = safeV; bestHealing = healing; bestNoise = noise;
          bestSafe = [k, r, c, dir];
        }
        // (the best road tile by the same value)
        if (preferRoad && model.ground.has(k) && v > bestRoadV) { bestRoadV = v; bestRoad = [k, r, c, dir]; }
        if (preferHigh && map.get(k) === 'ranged' && [...u.cover].some((ck) => model.ground.has(ck)) && v > bestHighV) {
          bestHighV = v;
          bestHigh = [k, r, c, dir];
        }
      }
    }
    const pick = bestSafe || bestHigh || bestRoad || best;
    if (!pick) continue;
    taken.add(pick[0]);
    layout.units.push(unitOf(r0, pick[0], pick[1], pick[2], pick[3], model));
    out.set(p.uid, pick[0]);
    out.dirs.set(p.uid, pick[3]);
    yield;
  }
  // [ASSUMED] Repair isolated self-range guards after the damage dealers have been placed. The route-wide kill
  // estimate can saturate even when the guard holds enemies out of range of all that downstream damage.
  // Product-policy tracking: https://github.com/sganggs/Stronghold-Protocol/issues/315
  for (const p of order) {
    const key = out.get(p.uid);
    const r0 = rec(p);
    if (p.kind === 'token' || !key || !isBlocker(r0) || r0.rangeGrid?.length !== 1
      || !r0.rangeGrid[0].every((v) => v === 0) || !model.ground.has(key)) continue;
    const index = layout.units.findIndex((u) => u.key === key);
    if (index < 0) continue;
    const unit = layout.units[index];
    const support = (k) => supportedContact(model, layout.units, k, unit);
    if (support(key)) continue;
    let best = unit;
    let bestV = layout.value();
    for (const [r, c] of legalTiles(map, placeClass(ps, pgd.chess(p.id) || r0))) {
      const k = tileKey(r, c);
      if (taken.has(k) || !model.ground.has(k) || !support(k)) continue;
      const candidate = unitOf(r0, k, r, c, unit.dir, model);
      layout.units[index] = candidate;
      const v = layout.value();
      layout.units[index] = unit;
      if (v >= bestV) { best = candidate; bestV = v; }
    }
    if (best !== unit) {
      taken.delete(key); taken.add(best.key);
      layout.units[index] = best;
      out.set(p.uid, best.key);
    }
    yield;
  }
  return out;
}

/** A plan's direction for a piece (plans without directions ⇒ RIGHT). */
const planDir = (plan, uid) => (plan && plan.dirs instanceof Map ? plan.dirs.get(uid) : null) ?? 'RIGHT';

/**
 * [ASSUMED] #315: game seconds of a Final Assault / Hidden Core the layout rehearsal plays when the round has no
 * `levelMaxPlayTime`. The visible countdown is that value in real seconds times the combat clock (120 × 2 = 240 game
 * seconds). The battle has no time limit and overtime is past the countdown, so neither is rehearsed. A prefix that
 * ends before escorts leak ranks every layout as a clean hold and then keeps the one with the most early leader
 * damage, which is not the fight the countdown shows.
 */
export const FA_REHEARSAL_SECONDS = 240;

/** Ticks of the boss-round layout rehearsal: the visible countdown on the combat clock, else `FA_REHEARSAL_SECONDS`. */
export function faRehearsalTicks(m) {
  const real = m && m.gd && typeof m.gd.bossLevelTime === 'function' ? m.gd.bossLevelTime(m.round) : null;
  const scale = m && m.gd && m.gd.combatTimeScale > 0 ? m.gd.combatTimeScale : 2;
  const seconds = (real > 0 ? real : 120) * scale;
  return Math.round((seconds > 0 ? seconds : FA_REHEARSAL_SECONDS) * 30);
}

/**
 * [ASSUMED] #315: battle seed of a Final Assault rehearsal. It is not derived from the match seed, and it is not the
 * live fight's `deriveSeed(match.seed, fieldId:round)`. The same seed is used for every candidate of this seat.
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 */
export function faRehearsalSeed(m, ps) {
  return deriveSeed(0xA11CE, `fa:${m.round}:${ps.seat}`);
}

/** Detached board of one candidate (uid → tile). */
function plannedBoard(byUid, plan) {
  const board = new Map();
  for (const [uid, key] of plan) {
    const p = byUid.get(uid);
    if (p) board.set(key, { ...p, dir: planDir(plan, uid) });
  }
  return board;
}

/**
 * One Final Assault candidate. The wave is the one `startRound` already planned (`bossWaves`); this does not roll
 * `rngWaves`. The rehearsing seat fights on its planned board; a teammate fights on the board that is deployed now.
 * Preview dispatch only. A fresh pool per candidate, the visible sum of LP, and {@link faRehearsalSeed}.
 * `waveSpawns` is the field's wave before the bounties, the same copy the live boss start passes (GitHub #839).
 * @returns {object|null}
 */
function bossCandidateOpts(m, ps, byUid, plan) {
  const g = typeof m.bossGroupOf === 'function' ? m.bossGroupOf(ps) : null;
  const wave = g && g.wave;
  if (!wave || !m.dispatcher) return null;
  const players = g.players.map((id) => m.players.get(id)).filter(Boolean);
  const hidden = m.round === m.gd.hiddenRound && m.round !== m.gd.bossRound;
  const kind = hidden ? 'hidden' : 'boss';
  const bossId = hidden ? m.hiddenBossId : m.bossId;
  let spawns = (Array.isArray(wave.spawns) ? wave.spawns : []).map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
  const waveSpawns = (Array.isArray(wave.spawns) ? wave.spawns : []).map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
  players.forEach((p, j) => {
    for (const b of bountySpawns(m.gd, m.round, wave, p.bounties, p.playerId, { solo: !!m.isSolo, side: j === 0 ? 'L' : 'R' })) spawns.push(b);
  });
  let routes = wave.routes;
  const alive = typeof m.alivePlayers === 'function' ? m.alivePlayers() : players;
  const teamLp = alive.reduce((s, p) => s + Math.max(0, p.lp), 0);
  const inputs = [];
  for (let j = 0; j < players.length; j++) {
    const p = players[j];
    const board = p.playerId === ps.playerId ? plannedBoard(byUid, plan) : p.board;
    const view = previewPlayer(p, board);
    const input = view.battleInput({ side: j === 0 ? 'L' : 'R', colOffset: j === 0 ? 0 : 8 });
    input.lpForBoss = teamLp;
    const ev = {
      input, kind, round: m.round, spawns, waveSpawns, routes,
      side: players.length > 1 ? (j === 0 ? 'L' : 'R') : null,
      preview: true,
    };
    m.dispatcher.dispatch(view, 'onBattleStart', ev);
    if (ev.input && typeof ev.input === 'object') inputs.push(ev.input);
    else inputs.push(input);
    if (Array.isArray(ev.spawns)) spawns = ev.spawns;
    if (Array.isArray(ev.routes)) routes = ev.routes;
  }
  const hp = bossPoolHp(m.gd, bossId, alive.length);
  return {
    seed: faRehearsalSeed(m, ps),
    kind,
    modeId: m.modeId,
    round: m.round,
    stageId: m.stageId,
    rect: { ...GEO.BOSS_RECT },
    timeLimit: Infinity,
    players: inputs,
    spawns: m._sanitizeSpawns(spawns),
    routes,
    sharedBoss: new SharedBossPool(hp),
    // the spec the host's browser rebuilds the pool from (buildBattleSpec reads `boss`, not the live pool object)
    boss: { poolHp: hp, poolMax: hp },
    flags: { layerGainsEnabled: false, ...m.gd.dp, enemyScale: m.gd.enemyScale(m.round) },
    fieldId: `rb:${ps.playerId}`,
    enemyOverrides: wave.overrides,
    waveId: wave.templateId,
    bossId,
  };
}

/** Layout-model variants the rehearsal compares (the first one is the default plan). */
export const REHEARSAL_VARIANTS = Object.freeze([
  {},
  { spread: 3, secondHold: 0.2 },
  { hold: 2 },
  { hold: 8 },
  { kill: 3 },
]);

/** Distinct plans (same unit → tile assignment ⇒ one candidate), in order. */
function distinctPlans(plans) {
  const out = [];
  const seen = new Set();
  for (const plan of plans) {
    const sig = [...plan.entries()].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}@${k}:${planDir(plan, u)}`).join(' ');
    if (!seen.has(sig)) { seen.add(sig); out.push(plan); }
  }
  return out;
}

/**
 * One candidate's battle options: the round's enemies against a detached copy of the plan's board.
 * `Match._normalOpts(..., { preview: true })` (DESIGN §32.14.5): the normal field seed, start effects, enemy
 * replacements and layer gains, on an isolated dispatcher. The live board, funds, layers and the room's script
 * budget are not touched. A delegated rehearsal turns the same object into a BattleSpec.
 * @returns {object}
 */
function candidateOpts(m, ps, byUid, plan) {
  return { ...m._normalOpts(ps, { preview: true, board: plannedBoard(byUid, plan) }), fieldId: `r:${ps.playerId}` };
}

/**
 * Rehearsal job: the candidate layouts of one prep, the best of them and the server's own run over them. `inputs`
 * are the candidates' preview battle options (candidateOpts). `prebuilt`, when given, is the Battle of each input
 * already constructed — the default path builds them in the generator, exactly when 0.3.0 did, so a rehearsal that
 * stays on the server spends its construction where it always did. A takeover passes none: the run builds each
 * Battle when its turn comes (server/sim/rehearsal.js), inside the same slice budget as its stepping, and a preview
 * that throws is discarded without a match error.
 * `run(budgetMs)` steps until every candidate is done (false: still running); `done` is only true then, and `best`
 * is the winner — the default plan (`plans[0]`) while no candidate beat it.
 */
export function createRehearsalJob(m, ps, chosen, plans, inputs, prebuilt = null, cap = null, limits = null) {
  const ticks = Number.isFinite(cap) ? cap : rehearsalCap(m.wave && m.wave.timeLimit);
  let run = null;
  const held = prebuilt ? prebuilt.slice() : null;
  const factories = held
    ? held.map((_, i) => () => { const battle = held[i]; held[i] = null; return battle; })
    : inputs.map((o) => () => m.newBattle(o, { preview: true }));
  const job = {
    chosen, plans, inputs, cap: ticks, limits, stats: null, best: plans[0], done: false, pending: false,
    run(budgetMs = Infinity, control = null) {
      if (job.done) return true;
      if (!run) run = new RehearsalRun(factories, ps.playerId, ticks, limits || {});
      // A test replay (`control.replaying`) stops on the journalled step count, not the wall clock.
      const replaying = !!(control && control.replaying);
      const timed = !replaying && Number.isFinite(budgetMs);
      const t0 = timed ? performance.now() : 0;
      const over = () => (replaying ? control.stop() : performance.now() - t0 >= budgetMs);
      job.done = run.run(timed || replaying ? over : null, control);
      job.best = job.plans[run.score.index] || job.best;
      job.stats = { totalTicks: run.totalTicks, completed: run.completed, considered: run.index,
        stopReason: run.stopReason, choice: run.score.index, candidates: factories.length };
      return job.done;
    },
  };
  return job;
}

/**
 * The same job with its candidates handed to the match's current host (DESIGN §14 rehearsal delegation): the browser
 * simulates the specs and only the winning index comes back (`accept`, which leaves `done` true and the pick in `best`
 * — the server is done with this rehearsal and simulates nothing), so `pending` is true until then — a takeover
 * (`takeOver`, `done` still false) runs the very same candidates here instead. A synchronous `run` (the one-shot
 * botPrep, tools, tests) takes a delegated job over at once: no browser can answer within one call.
 */
export function createDelegatedRehearsalJob(m, ps, chosen, plans, inputs, cap = null, limits = null) {
  const job = createRehearsalJob(m, ps, chosen, plans, inputs, null, cap, limits);
  const step = job.run;
  job.pending = true;
  /** The host's pick (MatchRehearsal checked the sender, the task and the index). */
  job.accept = (index) => { if (!job.pending) return; job.pending = false; job.done = true; job.best = job.plans[index]; };
  /** The server runs the same candidates (timeout, host gone, a failed or refused task). */
  job.takeOver = () => { job.pending = false; };
  job.run = (budgetMs, control) => { if (job.pending) job.takeOver(); return step(budgetMs, control); };
  return job;
}

/**
 * Rehearsal job: a player "tries out" candidate layouts — each distinct plan (up to m.botRehearsal) is simulated once
 * against the round's enemies with the real Battle and normal inputs, including start effects and layer gains.
 * [ASSUMED] Use the normal field seed (#315), with an independent meta RNG per candidate and no settlement.
 * The plan with the fewest counted leaks (then the most leader damage, then the most kills) wins (server/sim/rehearsal.js, on both sides of a
 * delegated rehearsal). Every candidate's Battle is built from a detached board (the live board is never modified).
 * The job can be stepped later: `job.run(budgetMs)` simulates until the wall-clock budget is used (checked every 4
 * ticks) and returns true once every candidate is done. A candidate whose counted leaks already exceed the best
 * finished one's stops early (it can no longer win).
 * @returns {null | ReturnType<typeof createRehearsalJob>} null when there is nothing to compare (no wave and no boss
 *   group, < 2 distinct plans, rehearsal off)
 */
export function createRehearsal(m, ps, chosen, plans) {
  return runSteps(createRehearsalSteps(m, ps, chosen, plans));
}

/**
 * createRehearsal as a step generator: yields after each candidate's preview input is taken (and, unless `delegate`,
 * after that candidate's Battle is built). Dropping the job between steps leaves all live state untouched, including
 * hand/temp, summons and dirty flags — the board the input was taken from is a copy.
 * `delegate` (the async bot-prep driver, Match.scheduleBotPrep): the candidates are offered to the current host's
 * browser (Match.delegateRehearsal — an AI teammate's prep only, and never a gameplay-plugin room). Nothing is built
 * here in that case; a synchronous caller leaves it off and simulates on the server.
 */
export function* createRehearsalSteps(m, ps, chosen, plans, { delegate = false, pooled = false, limits = null, candidateLimit = m.botRehearsal } = {}) {
  const boss = !m.wave && bossWaveOf(m, ps);
  const distinct = distinctPlans(plans);
  if ((!m.wave && !boss) || distinct.length < 2 || !(m.botRehearsal > 0)) return null;
  // [ASSUMED] #315: a boss field has no time limit. Cap the rehearsal; do not use the live fight's seed.
  const cap = boss ? faRehearsalTicks(m) : null;
  const cands = distinct.slice(0, Math.min(8, candidateLimit));
  const byUid = new Map(chosen.map((p) => [p.uid, p]));
  const inputs = [];
  const battles = [];
  // A rehearsal that may leave this thread — the host's browser (delegate) or the server's own pool (pooled) — builds
  // nothing here: those paths simulate the inputs and the takeover builds them later. Only a run that stays inline
  // builds each candidate Battle in this generator step, at the point 0.3.0 built it.
  const remote = delegate || pooled;
  for (const plan of cands) {
    try {
      const opts = boss ? bossCandidateOpts(m, ps, byUid, plan) : candidateOpts(m, ps, byUid, plan);
      if (!opts) break;
      inputs.push(opts);
      // The default path builds now, in this generator step, as 0.3.0 did. Delegation builds nothing: the host
      // simulates the specs, and a takeover builds these same inputs later.
      if (!remote && !limits) battles.push(m.newBattle(opts, { preview: true }));
    } catch {
      // A failed estimate cannot affect the match's error log or displace its default plan.
      break;
    }
    yield;
  }
  if (limits) cands.length = inputs.length;
  if (delegate && typeof m.delegateRehearsal === 'function') {
    const job = m.delegateRehearsal({ ps, chosen, plans: cands, inputs, cap, limits });
    if (job) return job;
  }
  // the server's own simulation pool (server/workers/roomPool.js), when the operator started one: the same candidates,
  // run on a thread instead of this one. A pool that is off, busy or broken returns null and the local run below takes
  // over — a refusal costs latency, never a different layout (MatchRehearsal.poolRehearsal). Only the asynchronous bot
  // prep driver asks for it (`pooled`): a synchronous caller cannot wait for a thread, so it keeps simulating inline.
  if (pooled && typeof m.poolRehearsal === 'function') {
    const job = m.poolRehearsal({ ps, chosen, plans: cands, inputs, cap, limits });
    if (job) return job;
  }
  return createRehearsalJob(m, ps, chosen, cands, inputs, remote || limits ? null : battles, cap, limits);
}

/**
 * Synchronous rehearsal (tools, tests): see createRehearsal. The board is restored exactly afterwards.
 * @returns {Map<number, string>} the chosen plan
 */
export function rehearse(m, ps, chosen, plans) {
  const job = createRehearsal(m, ps, chosen, plans);
  if (!job) return distinctPlans(plans)[0] || plans[0];
  job.run();
  return job.best;
}

// ---------------------------------------------------------------------------------------------------
// prep routine

function tryDo(fn) {
  try { const r = fn(); return !!(r && r.ok); } catch { return false; }
}

function canUseItem(m, ps, item) {
  const rec = m.gd.item(item.id);
  if (!rec) return false;
  if (rec.itemType === 'MAGIC') return m.registry.has('item:' + itemKey(item.id));
  const consume = typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip');
  if (consume) return m.registry.has('item:' + itemKey(item.id));
  return true;
}

function context(m, ps, policy = null) {
  const owned = ownedBonds(m, ps);
  const model = fieldModel(m, ps);
  const plan = bondPlan(m, ps, owned);
  const copies = copyCounts(m, ps);
  let pairs = 0;
  for (const [b, k] of copies) if (k + 1 >= mergeNeed(m, b)) pairs++;
  const keep = keeperBases(m, ps, plan);
  if (policy) for (const p of ps.allChess()) if (policy.core(m, ps, p.id)) keep.add(m.gd.baseIdOf(p.id));
  return { ps, policy, owned, focus: plan.focus, second: plan.second, keep, copies, pairs, roles: roles(m, ps), fly: model.flyTotal, model,
    mateBonds: teammateBonds(m, ps) };
}

/** Normal copies owned per base (board, hand, temp). */
function copyCounts(m, ps) {
  const out = new Map();
  for (const p of ps.allChess()) {
    if (m.gd.isGolden(p.id)) continue;
    const b = m.gd.baseIdOf(p.id);
    out.set(b, (out.get(b) || 0) + 1);
  }
  return out;
}

/**
 * Expected value of one shop refresh: Σ over the owned bases one copy short of an elite of P(the refresh shows a copy)
 * × MERGE_HIT, plus the keeper singles × PAIR_HIT. P = 1 − (1 − left / eligible copies)^chess slots — the shop's
 * copy-weighted roll over the shared pool's tiers ≤ shop level (PlayerState._rollChessSlot, pool.js roll).
 */
function refreshValue(m, ps, ctx) {
  const L = ps.shop.level;
  let total = 0;
  for (const e of m.pool.entries.values()) if (e.left > 0 && e.tier <= L) total += e.left;
  if (!(total > 0)) return 0;
  const slots = m.gd.shopSlots(L).chess;
  let v = 0;
  for (const [b, k] of ctx.copies) {
    const e = m.pool.entries.get(b);
    if (!e || e.left <= 0 || e.tier > L) continue;
    const pShop = 1 - (1 - e.left / total) ** slots;
    if (k + 1 >= mergeNeed(m, b)) v += pShop * MERGE_HIT;
    else if (ctx.keep.has(b)) v += pShop * PAIR_HIT;
  }
  // §35.63: a refresh may also show a missing member of the focus core bond on its way to the top threshold
  if (coreGap(m, ctx.focus, ctx.owned)) {
    let miss = 1;
    for (const [id, e] of m.pool.entries) {
      if (!(e.left > 0) || e.tier > L || ctx.owned.bases.has(id)) continue;
      const c = m.gd.chess(id);
      if (c && (c.bonds || []).includes(ctx.focus)) miss *= (1 - e.left / total) ** slots;
    }
    v += (1 - miss) * CORE_HIT;
  }
  return v;
}

/**
 * Sell the weakest bench chess (temp and hand; the hand only with `handOnly`) that is not part of a merge pair (or
 * anything when keepPairs is false) and does not carry a 突变细胞 (its transformation after the battle is the point).
 * `keepFresh`: never a piece that came this prep (`boughtRound`: bought for the lineup, an elite just merged, a reward)
 * nor one gained since the bot's last prep ended (unseen, see rememberOwned: the operator a 突变细胞 transformation
 * gains joins the bench while its carrier's deployment is free — the placement step decides about it, not the shed's
 * piece value).
 */
export function sellWeakestHand(m, ps, { keepPairs = true, below = Infinity, handOnly = false, keepFresh = false } = {}) {
  const advisor = !!economyPlan(m, ps);
  if (advisor) {
    if (advisorRoomStep(m, ps, { handOnly, below, keepFresh, keepPairs })) return true;
    // [ASSUMED] Never sell protected pieces pre-emptively for a speculative purchase.
    if (freeSlot(ps.hand) >= 0) return false;
  }
  const ctx = context(m, ps);
  let worst = null;
  let worstV = Infinity;
  for (const p of handOnly ? ps.hand : [...ps.temp, ...ps.hand]) {
    if (!p || p.kind !== 'chess' || (p.items || []).some((it) => isMutationCell(m.gd, it.id))) continue;
    const base = m.gd.baseIdOf(p.id);
    if (keepPairs && !m.gd.isGolden(p.id) && (ctx.copies.get(base) || 0) >= 2) continue;
    if (keepFresh && (p.boughtRound === m.round || unseen(ps, p))) continue;
    // §35.63: an advisor's full hand of protected pieces may still give up a tier <= 4 one (legal room), never an
    // elite, a tier 5/6 carry or a merge piece (cycle 2: 11 tier 5/6 sales for 1 fund each, 荒芜拉普兰德 for a tier-1 copy)
    const guarded = advisor && advisorProtected(m, ps, p);
    if (guarded && (m.gd.isGolden(p.id) || m.gd.tierOf(p.id) >= 5 || ps.completesChessMerge(p.id))) continue;
    const v = pieceValue(m, ps, p, ctx) + (guarded ? 50 : 0);
    if (v < worstV) { worstV = v; worst = p; }
  }
  if (!worst || worstV >= below) return false;
  return tryDo(() => ps.sell(worst.uid));
}

/**
 * The chess the bot owned when its last prep ended (`ps._botSeenUids`, written by botPrepEndSteps before Ready). A
 * piece outside it was gained after that prep — at SETTLE (a 突变细胞 transformation's operator, battle-result grants),
 * at the round start or in 机变 — and has not been through a placement step yet. No memory yet (a bot's first prep, a
 * seat just put under AI 托管): nothing counts as unseen.
 */
function rememberOwned(ps) {
  ps._botSeenUids = new Set(ps.allChess().map((p) => p.uid));
}
const unseen = (ps, p) => !!ps._botSeenUids && !ps._botSeenUids.has(p.uid);

/** Lineup gain of one copy of chess `id` (full board): best single swap into the current best lineup `cur`. */
function lineupGain(m, ps, id, ctx, cur) {
  const probe = { uid: -1, kind: 'chess', id, items: [] };
  let best = cur.score;
  for (let i = 0; i < cur.set.length; i++) {
    const trial = cur.set.slice();
    trial[i] = probe;
    // The purchase occupies a hand slot before arrangeSteps can withdraw the replaced operator.
    best = Math.max(best, lineupScore(m, ps, trial, ctx, Math.max(0, countFree(ps.hand) - 1)));
  }
  return best - cur.score;
}

/**
 * Prep start: sell bench chess that neither make the lineup nor build toward something (a pair that can still
 * merge, the focus bond, an elite) — they only block merges; the refund buys more. Keeps a few spare bench units.
 */
export function sellJunk(m, ps, policy = null) {
  const ctx = context(m, ps, policy);
  const { bench } = chooseLineup(m, ps, ctx);
  const keep = [];
  const junk = [];
  const banks = economyPlan(m, ps) ? new Set(advisorBanks(m, ps).map(p => p.uid)) : null;
  for (const p of bench) {
    if (banks?.has(p.uid) || (banks && (advisorWanted(m, ps, p.id) || advisorProtected(m, ps, p)))) continue;
    const c = chessRec(m, p.id, ps);
    if (!c) continue;
    const base = m.gd.baseIdOf(p.id);
    const copies = c.isGolden ? 0 : ctx.copies.get(base) || 0;
    // a pair whose third copy can still come (the merge's reward is worth it for any pair)
    const pairLive = copies + 1 >= mergeNeed(m, base) && (m.pool.left(base) > 0 || !m.pool.has(base));
    const coreReady = (c.bonds || []).some((b) => m.gd.bond(b)?.isCore && (ctx.owned.counts.get(b) || 0) >= CORE_KEEP_OWNED);
    const useful = c.isGolden || pairLive || ctx.keep.has(base) || coreReady || (copies >= 2 && m.round <= 6);
    (useful ? keep : junk).push({ p, v: pieceValue(m, ps, p, ctx) + (pairLive ? 150 : useful ? 100 : 0) });
  }
  // bench budget: at most BENCH_BUDGET spare units beyond the lineup (pairs first)
  const all = keep.concat(junk).sort((a, b) => b.v - a.v);
  if (banks) {
    const sales = [...new Set([...all.slice(BENCH_BUDGET), ...(m.round >= 5 ? junk.slice(0, 4) : [])].map(x => x.p))]
      .sort((a, b) => advisorSaleRank(m, ps, a) - advisorSaleRank(m, ps, b)
        || pieceValue(m, ps, a, ctx) - pieceValue(m, ps, b, ctx) || a.uid - b.uid);
    for (const p of sales) if (ps.find(p.uid) && !advisorProtected(m, ps, p)) tryDo(() => ps.sell(p.uid));
    return;
  }
  for (const { p } of all.slice(BENCH_BUDGET)) tryDo(() => ps.sell(p.uid));
  for (const { p } of junk.slice(0, 4)) if (m.round >= 5 && ps.find(p.uid)) tryDo(() => ps.sell(p.uid));
}

/** Take the queued pick-one offers (merge rewards, special refreshes — free; they last until picked, the bot takes them at once). */
function takeOffers(m, ps, policy = null) {
  const gd = ps?.gd || m.gd;
  for (let guard = 0; guard < 4 && ps.offers.length; guard++) {
    const offer = ps.offers[0];
    const ctx = context(m, ps, policy);
    let best = -1;
    let bestS = -Infinity;
    offer.slots.forEach((s, i) => {
      if (s.sold) return;
      const sc = s.kind === 'item' ? (canUseItem(m, ps, s) ? 10 : 1) + gd.tierOf(s.id) * 3 : buyScore(m, ps, s.id, ctx);
      if (sc > bestS) { bestS = sc; best = i; }
    });
    if (best < 0) break;
    if (freeSlot(ps.hand) < 0) sellWeakestHand(m, ps, { keepPairs: false });
    if (!tryDo(() => ps.pickReward(best))) {
      // could not take it (sold out / no room): drop the offer
      ps.offers.shift();
      ps.dirty();
    }
  }
}

/**
 * Prep routine up to the final arrangement, whose default plan is already on the board. Returns the layout
 * rehearsal still to run (Match steps it in wall-clock-bounded slices, then calls botPrepEnd) or null.
 */
export function botPrepBegin(m, ps) {
  return runSteps(botPrepBeginSteps(m, ps));
}

/**
 * botPrepBegin as a step generator (the same actions in the same order, hence the same rng draws and decisions): it
 * yields between whole prep actions — never while the board holds a transient layout — so Match.scheduleBotPrep runs
 * it in wall-clock-bounded slices like the rehearsal (50–120 ms of planning in one callback late in a 4-bot match
 * otherwise). `delegate` (the async driver): offer the final rehearsal to the current host's browser; `pooled` (the
 * same driver): offer it to the server's own simulation pool instead of simulating it in this thread.
 * Returns the rehearsal job (or null).
 */
export function* botPrepBeginSteps(m, ps, options = {}) {
  return yield* LEGACY_PREP.prepBegin(m, ps, options);
}

/** Prep routine, end: the rehearsed layout (when it beat the default plan), temp, a free hand slot, Ready. */
export function botPrepEnd(m, ps, job = null) {
  runSteps(botPrepEndSteps(m, ps, job));
}

/** botPrepEnd as a step generator (see botPrepBeginSteps). */
export function* botPrepEndSteps(m, ps, job = null) {
  return yield* LEGACY_PREP.prepEnd(m, ps, job);
}

/**
 * Free one hand slot: on a bot's own seat a kept bounty Art goes first (“神秘顾客” pays its fund and passes to a
 * teammate when destroyed, 教鞭 gives nothing — its chance of a perfect-battle payout is worth less than a slot for a
 * merge), else the weakest bench single is sold. A human's seat under AI 托管 never loses an item this way.
 */
export function freeHandSlot(m, ps) {
  if (economyPlan(m, ps) && advisorRoomStep(m, ps, { handOnly: true })) return true;
  if (ps.isBot && !ps.autoplay) {
    const art = ps.hand.find((p) => p && p.kind === 'item' && isBountyArt(m.gd, p.id));
    if (art && tryDo(() => ps.destroy(art.uid))) return true;
  }
  return sellWeakestHand(m, ps);
}

/** The whole prep routine in one go (the rehearsal, if any, runs synchronously). */
export function botPrep(m, ps) {
  const job = botPrepBegin(m, ps);
  if (job) job.run();
  botPrepEnd(m, ps, job);
}

/**
 * Freeze the shop (free) when it shows a copy that would complete a held pair and the bot cannot afford it: the unsold
 * slots are kept at the next round start (PlayerState.startRound rollShop keepFrozen), the rest rerolled.
 */
function maybeFreeze(m, ps, policy = null) {
  if (ps.shop.frozen) return;
  if (ps.shop.slots.some((s) => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) > ps.funds
    && (economyPlan(m, ps) ? advisorFreezeTarget(m, ps, s.id) : ps.completesChessMerge(s.id))
    && (!policy || policy.core(m, ps, s.id) || buyScoreOf(m, ps, s.id, policy) >= 60))) tryDo(() => ps.freeze());
}

/** §35.14, maintainer 2026-10-20. [ASSUMED] Sell unprotected clutter before destroying cheap hand items.
 * One real action at a time: sales can return equipment / refill temp, so callers recheck the actual hand.
 */
function advisorRoomStep(m, ps, { handOnly = false, below = Infinity, extra = [], keepFresh = false, keepPairs = true } = {}) {
  const ctx = context(m, ps), gd = ps.gd || m.gd;
  // The legacy shed's guards still apply: never a piece of this prep (or unseen) when asked, and a live pair stays
  // together (copies of an owned elite can no longer merge, so they remain the first sale).
  const candidates = [...(handOnly ? ps.hand : [...ps.temp, ...ps.hand]), ...extra].filter(p =>
    p?.kind === 'chess' && !advisorProtected(m, ps, p) && pieceValue(m, ps, p, ctx) < below
    && !(keepFresh && (p.boughtRound === m.round || unseen(ps, p)))
    && !(keepPairs && !gd.isGolden(p.id) && !ownsElite(m, ps, p.id) && (ctx.copies.get(gd.baseIdOf(p.id)) || 0) >= 2))
    .sort((a, b) => advisorSaleRank(m, ps, a) - advisorSaleRank(m, ps, b)
      || pieceValue(m, ps, a, ctx) - pieceValue(m, ps, b, ctx) || a.uid - b.uid);
  if (candidates.length) return tryDo(() => ps.sell(candidates[0].uid));
  if (freeSlot(ps.hand) >= 0) return false;
  const item = ps.hand.filter(p => p?.kind === 'item' && gd.item(p.id)?.price <= 2)
    .sort((a, b) => gd.item(a.id).price - gd.item(b.id).price || a.uid - b.uid)[0];
  return !!item && tryDo(() => ps.destroy(item.uid));
}

function advisorPrepState(m, ps) {
  if (ps._advisorBought?.round !== m.round) ps._advisorBought = { round: m.round, uids: new Set(), refreshStart: ps.stats.refreshes };
  return ps._advisorBought;
}

function buyOffer(m, ps, index) {
  const plan = economyPlan(m, ps), slot = ps.shop.slots[index];
  const protect = plan && slot?.kind === 'chess' && planBuyTarget(m, ps, slot.id);
  const before = protect ? new Set(ps.allChess().map(p => p.uid)) : null;
  if (!tryDo(() => ps.buy(index))) return false;
  if (protect) for (const p of ps.allChess()) {
    if (!before.has(p.uid) && ps.gd.baseIdOf(p.id) === ps.gd.baseIdOf(slot.id)) advisorPrepState(m, ps).uids.add(p.uid);
  }
  // [ASSUMED] Equip between purchases so several items cannot all claim the same free carrier slot.
  if (plan && slot?.kind === 'item') equipItems(m, ps);
  return true;
}

function advisorItemAllowed(m, ps, slot) {
  const plan = economyPlan(m, ps);
  if (!plan) return true;
  const free = countFree(ps.hand);
  if (!free) return false;
  const immediate = (ps.gd || m.gd).item(slot.id)?.itemType === 'EQUIP' && !!itemTarget(m, ps, slot);
  return immediate || free >= 3 || (free >= 2 && plan.items?.buy?.includes(slot.id));
}

function canFreezeSearch(m, ps, eligible) {
  const plan = economyPlan(m, ps), gd = ps.gd || m.gd;
  if (!plan?.economy?.freezeSearch || countFree(ps.hand) <= 1) return false;
  const state = advisorPrepState(m, ps), price = ps.shop.freeRefreshes > 0 ? 0 : gd.refreshPrice;
  if (ps.stats.refreshes - state.refreshStart >= (plan.economy.maxRefreshes ?? MAX_REFRESHES) || ps.funds < price) return false;
  return eligible.some(id => planBuyTarget(m, ps, id)
    && !ps.shop.slots.some(s => s && !s.sold && s.kind === 'chess' && gd.baseIdOf(s.id) === gd.baseIdOf(id))
    && ps.priceOf({ kind: 'chess', id, basePrice: gd.chessPrice(id) }) > ps.funds - price);
}

/** Whether level `lv` of the 调度中心 opens one of the player's slotted 自选 pieces with copies left (player/diy.js). */
export function diyOpensAt(ps, lv) {
  const st = ps.diyStock;
  if (!st || !st.entries || !st.entries.size) return false;
  for (const e of st.entries.values()) if (e.shopLevel === lv && e.left > 0) return true;
  return false;
}

/** The 调度中心 level-ups of a bot's prep (exported for tests). */
export function levelUp(m, ps, { spare = false, policy = null } = {}) {
  const gd = ps?.gd || m.gd;
  if (policy) {
    if (!policy.canLevel(m, ps) || ps.offers.length) return;
    if (ps.shop.slots.some(s => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) <= ps.funds
      && ps.completesChessMerge(s.id) && policy.core(m, ps, s.id))) return;
    return tryDo(() => ps.levelUp());
  }
  for (let guard = 0; guard < 6; guard++) {
    if (ps.shop.level >= gd.maxShopLevel) return;
    const price = Math.max(0, ps.shop.upgradePrice);
    if (ps.funds < price) return;
    const advisorEconomy = advisorPlan(m, ps)?.economy;
    if (advisorEconomy?.holdLevel && ps.shop.level >= advisorEconomy.level) return;
    if (advisorEconomy?.level != null) {
      if (ps.shop.level < advisorEconomy.level) {
        if (ps.funds - price < fundsReserve(m, ps) || !tryDo(() => ps.levelUp())) return;
        continue;
      }
    }
    const r = m.round;
    const target = LEVEL_TARGET[Math.min(LEVEL_TARGET.length - 1, r)];
    const nextTarget = LEVEL_TARGET[Math.min(LEVEL_TARGET.length - 1, r + 1)];
    // early levels only once the board is full (units first); later a 6-unit core is enough
    const boardReady = ps.allChess().length >= (r <= 4 ? ps.deployCap : Math.min(ps.deployCap, 6));
    let want = price === 0;
    if (!want && ps.shop.level < target && (boardReady || r >= 6)) want = true;
    // a human's 自选 slots of the next level (AI 托管): that step one round earlier (DIY_PIECE_BONUS)
    if (!want && boardReady && ps.shop.level < nextTarget && diyOpensAt(ps, ps.shop.level + 1)) want = true;
    if (!want && ps.shop.level < nextTarget && price <= 2 && boardReady) want = true;
    if (!want && spare && ps.funds >= price + 1 + fundsReserve(m, ps) && ps.shop.level < nextTarget + 1 && boardReady) want = true;
    if (!want && ps.funds >= price + 14) want = true;
    if (!want || !tryDo(() => ps.levelUp())) return;
  }
}

/**
 * Funds a band that keeps its leftover (gd.leftoverKeptBands: 坎诺特 利滚利 "每回合剩余的资金可以继承，剩余至少5资金时，
 * 每回合额外获得1资金") holds back from discretionary spending — refreshes, full-board purchases that complete nothing,
 * items, spare level-ups: the interest capital (coin_carry_over bb.capital, 5). 0 for every other band (their
 * leftover is lost at the prep end, so spending it all is free value).
 */
function fundsReserve(m, ps) {
  if (!m.gd.leftoverKeptBands.includes(ps.bandId)) return 0;
  const band = m.gd.band(ps.bandId);
  const buff = band && Array.isArray(band.buffs) ? band.buffs.find((b) => b && b.key === 'coin_carry_over') : null;
  const policy = advisorPlan(m, ps)?.economy;
  if (policy?.reserve != null) return policy.reserve;
  if (policy?.saveForInterest === false) return 0;
  const cap = Number(buff && buff.bb && buff.bb.capital);
  return Number.isFinite(cap) && cap > 0 ? cap : 5;
}

/**
 * §35.63: funds left after the buy loop (it keeps 2 for a purchase after each refresh) expire at the prep end
 * (PlayerState.endPrep): spend them on refreshes that may show a copy completing a held pair, which maybeFreeze then
 * keeps for the next round. Never refreshes away such a copy or a frozen shop; banking bands keep their funds. [ASSUMED]
 * At most 4 refreshes. Measured: funds lost per prep 0.78 → 0.25 (终极 solo, seeds 1–100, with the other §35.63 rules).
 */
function spendDown(m, ps) {
  if (economyPlan(m, ps) || m.gd.leftoverKeptBands.includes(ps.bandId)) return;
  const gd = ps.gd || m.gd;
  for (let guard = 0; guard < 4; guard++) {
    if (ps.shop.frozen || ps.shop.slots.some((s) => s && !s.sold && s.kind === 'chess' && ps.completesChessMerge(s.id))) return;
    const cost = ps.shop.freeRefreshes > 0 ? 0 : gd.refreshPrice;
    if (ps.funds < cost || (cost === 0 && guard > 0) || !tryDo(() => ps.refresh())) return;
    takeOffers(m, ps);
  }
}

// [ASSUMED] Delay optional merges only for a concrete affordable upgrade.
function deferPolicyMerge(m, ps, purchasePrice = 0, policy = null) {
  if (!policy || ps.shop.level >= 4 || ps.lp <= 10 || ps.deployCount < ps.deployCap) return false;
  if (!policy.canLevel(m, ps) || ps.funds < Math.max(0, ps.shop.upgradePrice) + purchasePrice) return false;
  const previous = m.lastResults.get(ps.playerId);
  return !!previous && !(previous.leaked || []).some(l => l.counted !== false);
}

/** Buying / rerolling toward the lineup; a step generator (yields after each purchase or reroll). */
export function* buyLoopSteps(m, ps, { fillOnly = false, maxRefreshes = 0, policy = null } = {}) {
  const gd = ps?.gd || m.gd;
  const advisorEconomy = advisorPlan(m, ps)?.economy;
  const advisor = economyPlan(m, ps);
  if (advisor) advisorPrepState(m, ps);
  if (advisorEconomy?.maxRefreshes != null) maxRefreshes = Math.min(maxRefreshes, advisorEconomy.maxRefreshes);
  let refreshes = 0;
  const minPrice = 2;
  const reserve = fundsReserve(m, ps);
  const customPolicy = !!policy;
  // the best lineup is reused while the owned chess stay the same (a refresh changes only the shop)
  let memo = null;
  for (let guard = 0; guard < 40; guard++) {
    if (guard > 0) yield;
    if (!policy && !fillOnly && tradeOnce(m, ps, () => context(m, ps))) continue;
    if (policy) takeOffers(m, ps, policy); // a merge reward can enable another merge before upgrading
    if (customPolicy && !fillOnly && policy.canLevel(m, ps)) {
      const oldLevel = ps.shop.level;
      levelUp(m, ps, { policy });
      if (ps.shop.level !== oldLevel) { memo = null; continue; }
    }
    // Do not cash a bank for a non-merge during the initial merge-only pass: the intervening level-up
    // could consume its refund before this pass is allowed to buy the target.
    // §35.14: complete merges first, then the affordable floor, before any fill-only single can spend it.
    const floorPending = advisor && advisorEconomy?.level > ps.shop.level && ps.funds >= Math.max(0, ps.shop.upgradePrice);
    if (advisor) for (const slot of ps.shop.slots) {
      if (!fillOnly || (!floorPending && ps.allChess().length < ps.deployCap) || (slot?.kind === 'chess' && ps.completesChessMerge(slot.id)))
        fundAdvisorPurchase(m, ps, slot);
    }
    const ctx = context(m, ps, policy);
    const ownedN = ps.allChess().length;
    const ownKey = `${ps.allChess().map((p) => `${p.uid}:${p.id}:${(p.items || []).length}`).join()}|${ctx.focus}|${ctx.second}`;
    const boardFull = ownedN >= ps.deployCap;
    // the first pass fills the board, then completes the merges it can afford — before any level-up spends the funds
    const mergesOnly = fillOnly && (boardFull || floorPending);
    // keep room for merges: a crowded bench sheds its weakest single — never one that came this prep (the buy picks by
    // lineup gain, the shed by piece value: it used to sell the single just bought for 3–5 back for 1; QA of the 0.1.1
    // bots) nor one gained since the last prep (the operator a 突变细胞 transformation put on the bench, its deployment
    // freed: in 20 solo 绝境 昆图斯 matches the shed sold 44 of 222 before the placement step could deploy them). The
    // shed is pre-emptive (one slot is still free), so with only fresh singles it waits for the next prep.
    const used = ps.hand.filter(Boolean).length;
    // [ASSUMED] Do not underfill the deploy cap merely to reserve a hand slot.
    // Product-policy tracking: https://github.com/sganggs/Stronghold-Protocol/issues/315
    if (used >= gd.benchSize - 1 && ownedN > ps.deployCap) sellWeakestHand(m, ps, { keepFresh: true });
    // a full hand refuses every purchase, the third copy of a held pair too (PlayerState.buy, PRTS 卫戍协议/帮助 §手牌区):
    // an affordable one sheds the weakest hand single first (like the shed above, never one of this prep)
    if (freeSlot(ps.hand) < 0 && ps.shop.slots.some((s) => s && !s.sold && s.kind === 'chess' && ps.priceOf(s) <= ps.funds
      && (ps.completesChessMerge(s.id) || (advisor && !mergesOnly && planBuyTarget(m, ps, s.id))))) {
      sellWeakestHand(m, ps, { handOnly: true, keepFresh: true });
    }
    // Reserve for searching only when this loop can actually refresh and buy.
    const refreshCost = ps.shop.freeRefreshes > 0 ? 0 : gd.refreshPrice;
    const canRefresh = refreshes < maxRefreshes && ps.funds - refreshCost >= (advisorEconomy?.refreshAbove ?? 0) && ps.funds >= refreshCost + (refreshCost > 0 ? Math.max(minPrice, reserve) : minPrice);
    let best = -1;
    let bestS = 0;
    let bestPrice = Infinity;
    let bestMerges = false;
    let cur = null;
    ps.shop.slots.forEach((s, i) => {
      if (!s || s.sold) return;
      const price = ps.priceOf(s);
      if (price > ps.funds) return;
      let sc;
      if (s.kind === 'chess') {
        if (advisor && ownsElite(m, ps, s.id)) return;
        const merges = ps.completesChessMerge(s.id);
        if (freeSlot(ps.hand) < 0 || (mergesOnly && !merges)) return;
        const base = gd.baseIdOf(s.id);
        const core = customPolicy && policy.core(m, ps, s.id);
        if (customPolicy) {
          if (fillOnly && !merges && policy.canLevel(m, ps)) return;
          const target = policy.target(m, ps, s.id);
          const hasElite = ps.allChess().some(p => gd.baseIdOf(p.id) === base && gd.isGolden(p.id));
          if (!gd.isGolden(s.id) && (hasElite || (target?.copies === 1 && ctx.owned.bases.has(base)))) return;
          // [ASSUMED] Delay a healthy optional merge only for a concrete, affordable upgrade.
          // A planned upgrade is performed above before the third copy is purchased.
          if (merges && !core && deferPolicyMerge(m, ps, price, policy)) return;
          if (fillOnly && !core && policy.canLevel(m, ps)
            && (!merges || ps.funds >= Math.max(0, ps.shop.upgradePrice) + price)) return;
        }
        if (boardFull && !merges && ps.funds - price < reserve) return; // banked (坎诺特)
        sc = buyScore(m, ps, s.id, ctx) - price;
        // §35.63: a missing member of the focus core bond is bought even when one swap does not raise the lineup yet,
        // while the bench keeps room for it and the members a later swap withdraws (3 free hand slots)
        const coreStep = !ctx.owned.bases.has(base) && countFree(ps.hand) >= 3 && (chessRec(m, s.id, ps)?.bonds || []).includes(ctx.focus)
          && !!coreGap(m, ctx.focus, ctx.owned);
        if (boardFull && !merges && !advisorWanted(m, ps, s.id) && !coreStep) {
          if (!ctx.copies.get(base)) {
            // with a full board a new operator must improve the lineup
            if (!cur) {
              if (!memo || memo.key !== ownKey) memo = { key: ownKey, cur: chooseLineup(m, ps, ctx) };
              cur = memo.cur;
            }
            const gain = lineupGain(m, ps, s.id, ctx, cur);
            if (gain <= 2 && !core) return;
            sc += Math.min(15, gain * 0.5);
          } else if (gd.isGolden(s.id) || (!ctx.keep.has(base) && !(ctx.pairs < MAX_PAIRS && (chessRec(m, s.id, ps)?.tier ?? 6) <= 3 && countFree(ps.hand) >= 3))) {
            // a second copy of a non-keeper with no bench room for another pair is clutter, sold later at a loss
            return;
          }
        }
        if (!boardFull) sc += 8;
      } else {
        if (fillOnly) return;
        if (!advisorItemAllowed(m, ps, s)) return;
        if (customPolicy && (policy.canLevel(m, ps) || (canRefresh && freeSlot(ps.hand) >= 0
          && policy.searchTargets(m, ps).some(t => ps.funds >= refreshCost
            + ps.priceOf({ kind: 'chess', id: t.base, basePrice: gd.chessPrice(t.base) }))))) return;
        if (!canUseItem(m, ps, { id: s.id })) return;
        if (freeSlot(ps.hand) < 0) return;
        if (ps.funds - price < reserve && !ps.completesItemMerge(s.id)) return;
        const carriers = [...ps.board.values()].filter((p) => p.kind === 'chess' && slotFree(m, ps, p, gd.item(s.id))).length;
        const requested = advisor?.items?.buy?.includes(s.id);
        if (!carriers && !requested) return;
        sc = 6 + (gd.tierOf(s.id) || 1) * 3 - price + (ps.completesItemMerge(s.id) ? 10 : 0) + (requested ? 24 : 0);
      }
      const merges = s.kind === 'chess' && ps.completesChessMerge(s.id)
        && (!customPolicy || policy.core(m, ps, s.id));
      const mergeFirst = !!policy && merges !== bestMerges;
      const betterScore = sc > bestS + 1e-9 || (best >= 0 && Math.abs(sc - bestS) <= 1e-9 && price < bestPrice);
      if (mergeFirst ? merges : betterScore) { bestS = sc; best = i; bestMerges = merges; bestPrice = price; }
    });
    // leftover funds are lost at prep end: reroll while a purchase stays affordable (a band that keeps them: down to its
    // reserve — a free refresh is always taken)
    // a full board buys only what improves it (merge progress, a lineup upgrade), and only when it is worth more than
    // the refreshes its price would pay for (each may show the third copy of a held pair, refreshValue)
    let buy = best >= 0 && bestS >= (boardFull ? BUY_FULL_MIN : 3);
    if (buy && boardFull && canRefresh && !bestMerges) {
      const price = Math.max(1, ps.priceOf(ps.shop.slots[best]));
      if (bestS < refreshValue(m, ps, ctx) * price / Math.max(1, refreshCost)) buy = false;
    }
    if (buy) {
      if (!buyOffer(m, ps, best)) return;
      continue;
    }
    if (canRefresh) {
      // Manual g.refresh cancels freezing and replaces its cards. Save wanted unaffordable offers first.
      if (economyPlan(m, ps) && ps.shop.slots.some(s => s && !s.sold && s.kind === 'chess'
        && advisorFreezeTarget(m, ps, s.id) && ps.priceOf(s) > ps.funds)) { maybeFreeze(m, ps); return; }
      if (!tryDo(() => ps.refresh())) return;
      refreshes++;
      continue;
    }
    return;
  }
}

/**
 * Maintainer 2026-10-19 (§35.13): expiring funds buy useful pieces, preserve unaffordable targets, search,
 * then hold cheap spare pieces for their sale value. [ASSUMED] 64 actions per pass bound free/effect loops;
 * leave one bench slot for next round, never trade bank pieces merely to buy more bank pieces.
 * Uses the ordinary buy/refresh/freeze/sell primitives (same handlers as g.*), preserving shared pool accounting.
 */
export function* advisorSpendSteps(m, ps) {
  const plan = economyPlan(m, ps);
  if (!plan) return;
  const carry = m.gd.leftoverKeptBands.includes(ps.bandId);
  if (carry && !plan.economy?.freezeSearch) return;
  const gd = ps.gd || m.gd;
  advisorPrepState(m, ps);
  ps._advisorBankUids = new Set(advisorBanks(m, ps).map(p => p.uid));
  for (let guard = 0; guard < 64; guard++) {
    if (guard) yield;
    if (!carry) for (const slot of ps.shop.slots) fundAdvisorPurchase(m, ps, slot);
    const item = carry ? -1 : ps.shop.slots.findIndex(s => s && !s.sold && s.kind === 'item'
      && plan.items?.buy?.includes(s.id) && ps.priceOf(s) <= ps.funds && advisorItemAllowed(m, ps, s));
    if (item >= 0) {
      if (!buyOffer(m, ps, item)) return;
      continue;
    }
    const ctx = context(m, ps), cur = chooseLineup(m, ps, ctx);
    const offers = ps.shop.slots.map((s, slot) => ({ s, slot }))
      .filter(({ s }) => s && !s.sold && s.kind === 'chess');
    const useful = offers.filter(({ s }) => !carry && !ownsElite(m, ps, s.id) && ps.priceOf(s) <= ps.funds && (advisorWanted(m, ps, s.id)
      || ps.completesChessMerge(s.id) || (ps.allChess().length < ps.deployCap)
      || lineupGain(m, ps, s.id, ctx, cur) > 2))
      .sort((a, b) => Number(advisorWanted(m, ps, b.s.id)) - Number(advisorWanted(m, ps, a.s.id))
        || buyScore(m, ps, b.s.id, ctx) - buyScore(m, ps, a.s.id, ctx));
    if (freeSlot(ps.hand) < 0 && useful.some(({ s }) => planBuyTarget(m, ps, s.id) || ps.completesChessMerge(s.id))
      && advisorRoomStep(m, ps, { handOnly: true })) continue;
    if (freeSlot(ps.hand) >= 0 && useful.length) {
      if (!buyOffer(m, ps, useful[0].slot)) return;
      takeOffers(m, ps);
      continue;
    }
    const preserve = offers.some(({ s }) => ps.priceOf(s) > ps.funds
      && advisorFreezeTarget(m, ps, s.id));
    if (preserve) maybeFreeze(m, ps);
    // Official draws require remaining eligible stock. Use effective prices, including free/discounted operators.
    const eligible = [...m.pool.entries].filter(([, e]) => e.left > 0 && e.tier <= ps.shop.level).map(([id]) => id);
    eligible.push(...(ps.diyRollEntries() || []).map(([id]) => id));
    const minPrice = Math.min(...eligible.map(id => ps.priceOf({ kind: 'chess', id, basePrice: gd.chessPrice(id) })), Infinity);
    const refreshPrice = ps.shop.freeRefreshes > 0 ? 0 : gd.refreshPrice;
    if (!preserve && ((!carry && countFree(ps.hand) >= 1 && ps.funds >= refreshPrice + minPrice)
      || canFreezeSearch(m, ps, eligible))) {
      if (!tryDo(() => ps.refresh())) return;
      continue;
    }
    if (carry) return;
    // [ASSUMED] Bank only spare, non-merge singles with available shared stock; cheapest first.
    const bank = offers.filter(({ s }) => ps.priceOf(s) <= ps.funds && gd.sellPrice(s.id) > 0
      && !ps.allChess().some(p => gd.baseIdOf(p.id) === gd.baseIdOf(s.id))
      && (!m.pool.has(s.id) || m.pool.left(s.id) > 0))
      .sort((a, b) => ps.priceOf(a.s) - ps.priceOf(b.s) || a.slot - b.slot)[0];
    if (countFree(ps.hand) <= 1 || !bank) return;
    const before = new Set(ps.allChess().map(p => p.uid));
    if (!buyOffer(m, ps, bank.slot)) return;
    for (const p of ps.hand) if (p?.kind === 'chess' && p.id === bank.s.id && !before.has(p.uid)) ps._advisorBankUids.add(p.uid);
  }
}

/**
 * Choose the deployed set and put it on the best tiles for this round's enemies (planLayout). `final`: the last
 * arrangement of the prep — candidate plans are rehearsed (see createRehearsal) when the match allows it; with `defer`
 * the default plan is placed now and the rehearsal job is returned (the caller runs it and applies `job.best`), and with
 * `delegate` that job may be the current host's browser instead (Match.delegateRehearsal).
 * @returns {null | ReturnType<typeof createRehearsalSteps>}
 */
export function arrange(m, ps, opts = {}) {
  return runSteps(arrangeSteps(m, ps, opts));
}

/** arrange as a step generator (yields inside the layout planning, see planLayoutSteps). */
export function* arrangeSteps(m, ps, { final = false, defer = false, delegate = false, pooled = false, candidatePlans = null, adaptive = false } = {}) {
  const ctx = context(m, ps);
  let chosen = chooseLineup(m, ps, ctx).set;
  let chosenSet = new Set(chosen.map((p) => p.uid));
  // withdraw board chess that are not chosen (to free cap) when the hand has space
  for (const [, p] of [...ps.board]) {
    if (p.kind !== 'chess' || chosenSet.has(p.uid)) continue;
    if (economyPlan(m, ps)) {
      if (!ps.find(p.uid)) continue;
      // [ASSUMED] Recompute after each sale: it may remove a chosen bench unit or return equipment/temp.
      for (let guard = 0; guard < 32 && freeSlot(ps.hand) < 0; guard++) {
        const extra = [...ps.board.values()].filter(p => p.kind === 'chess' && !chosenSet.has(p.uid));
        if (!advisorRoomStep(m, ps, { handOnly: true, extra })) break;
        chosen = chooseLineup(m, ps, context(m, ps)).set;
        chosenSet = new Set(chosen.map(p => p.uid));
        if (!ps.find(p.uid) || chosenSet.has(p.uid)) break;
      }
      if (!ps.find(p.uid) || chosenSet.has(p.uid)) continue;
    }
    const idx = freeSlot(ps.hand);
    if (idx >= 0) tryDo(() => ps.move(p.uid, { area: 'hand', idx }));
    else tryDo(() => ps.sell(p.uid));
  }
  yield;
  let plans = [];
  // A boss round has no `m.wave`. The already-planned boss group is rehearsed the same way, on its own seed.
  if (final && (m.wave || bossWaveOf(m, ps)) && m.botRehearsal > 0) {
    for (const v of REHEARSAL_VARIANTS) plans.push(yield* planLayoutSteps(m, ps, chosen, { ...LAYOUT_PARAMS, ...v }));
  } else {
    plans.push(yield* planLayoutSteps(m, ps, chosen));
  }
  if (candidatePlans && final && m.wave && m.botRehearsal > 1) {
    plans = yield* candidatePlans(m, ps, chosen, plans);
  }
  if ((defer || adaptive) && plans.length > 1) {
    const limits = adaptive ? { stage: 3, tickBudget: 6 * (!m.wave && bossWaveOf(m, ps) ? faRehearsalTicks(m) : rehearsalCap(m.wave?.timeLimit)) } : null;
    const job = yield* createRehearsalSteps(m, ps, chosen, plans,
      { delegate, pooled, limits, candidateLimit: adaptive ? 8 : m.botRehearsal });
    if (!defer && job) job.run();
    yield* applyPlanSteps(m, ps, chosen, !defer && job ? job.best : plans[0]);
    return job;
  }
  yield* applyPlanSteps(m, ps, chosen, plans.length > 1 ? rehearse(m, ps, chosen, plans) : plans[0]);
  return null;
}

/**
 * [ASSUMED] Opt-in, map-independent contact candidate. Preserve the default and the earlier variants, allocating
 * the last available rehearsal slot to a distinct repair. This keeps the existing configured budget (at most 8).
 * With the default budget of 3, merely appending to all 5 legacy plans would never rehearse the extra candidate.
 */
export function* contactCandidatePlansSteps(m, ps, chosen, plans, { budget = Math.min(8, Math.floor(m.botRehearsal)) } = {}) {
  if (!(budget > 1) || !m.wave || !Number.isInteger(m.round) || m.round < 1
    || m.round === m.gd.bossRound || m.round === m.gd.hiddenRound || !plans.length) return plans;
  const model = fieldModel(m, ps);
  if (!model.routes.length) return plans;
  const base = plans[0], pgd = ps.gd || m.gd, deployMap = ps.deployMap();
  const units = [];
  for (const piece of chosen) {
    const key = base.get(piece.uid), rec = rangeRec(ps, pgd.chess(piece.id));
    if (piece.kind !== 'chess' || !key || !rec) return plans;
    const [r, c] = parseKey(key);
    units.push({ ...unitOf(rec, key, r, c, planDir(base, piece.uid), model), uid: piece.uid, kind: piece.kind,
      placementClass: placeClass(ps, pgd.chess(piece.id)) });
  }
  const repaired = yield* refineFormationSteps(model, units, function* (unit) {
    for (const [r, c] of legalTiles(deployMap, unit.placementClass)) {
      const key = tileKey(r, c);
      for (const dir of PLAN_DIRS) yield { ...unit, ...unitOf(unit.rec, key, r, c, dir, model) };
    }
  });
  if (repaired === units) return plans;
  const candidate = new LayoutPlan(base);
  for (const unit of repaired) { candidate.set(unit.uid, unit.key); candidate.dirs.set(unit.uid, unit.dir); }
  const distinct = distinctPlans(plans);
  if (distinctPlans([...distinct, candidate]).length === distinct.length) return plans;
  return [...distinct.slice(0, budget - 1), candidate];
}

/** [ASSUMED] Fixed-three prefix, remaining legacy variants, then contact repairs of those variants; max eight.
 * Reuses map-independent planners, without RNG draws or mutations of Match configuration. */
export function* adaptiveCandidatePlansSteps(m, ps, chosen, plans) {
  const fixed = (yield* contactCandidatePlansSteps(m, ps, chosen, plans, { budget: 3 })).slice(0, 3);
  let pool = distinctPlans([...fixed, ...plans]);
  for (const base of plans.slice(1)) {
    if (pool.length >= 8) break;
    const repaired = yield* contactCandidatePlansSteps(m, ps, chosen, [base], { budget: 2 });
    pool = distinctPlans([...pool, ...repaired]);
  }
  return pool.slice(0, 8);
}

/** Trusted strategy hook pair; selecting it is explicit and leaves the legacy adapter untouched. */
export function createContactPrepSteps() {
  return createBotPrepSteps({
    arrangeSteps: (m, ps, options = {}) => arrangeSteps(m, ps, { ...options, candidatePlans: contactCandidatePlansSteps }),
  });
}

/**
 * Put the chosen pieces on their planned tiles, fill what is still off the board, then place summons. Placed summons go
 * back to their stacks first: they would sit on the plan's tiles (an operator moved onto one swaps it elsewhere), and a
 * 凯瑟琳 device left beside a tile its operator moved away from would face nothing (QA, playtest #6).
 */
function* applyPlanSteps(m, ps, chosen, target) {
  liftTokens(ps);
  // move pieces onto their targets (board → board moves swap; hand → board may swap an occupant back to the hand)
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const p of chosen) {
      const k = target.get(p.uid);
      if (!k) continue;
      const loc = ps.find(p.uid);
      const dir = planDir(target, p.uid);
      if (!loc || (loc.area === 'board' && loc.key === k && pieceDir(loc.piece) === dir)) continue;
      const [r, c] = parseKey(k);
      // onto its own tile: an in-place re-orientation (not a move)
      if (tryDo(() => ps.move(p.uid, { area: 'board', row: r, col: c }, dir)) && loc.key !== k) moved = true;
    }
    if (!moved) break;
  }
  // anything chosen still off the board: the best remaining free tile
  // (the server's g.move decides legality: a refused tile is excluded on the second pass)
  const refused = new Set();
  for (let pass = 0; pass < 2; pass++) {
    const off = chosen.filter((p) => { const loc = ps.find(p.uid); return loc && loc.area !== 'board'; });
    if (!off.length || ps.deployCount >= ps.deployCap) break;
    yield;
    const again = yield* planLayoutSteps(m, ps, off, LAYOUT_PARAMS, { occupied: new Set([...ps.board.keys(), ...refused]) });
    for (const p of off) {
      const k = again.get(p.uid);
      if (!k || ps.deployCount >= ps.deployCap) continue;
      const [r, c] = parseKey(k);
      if (!tryDo(() => ps.move(p.uid, { area: 'board', row: r, col: c }, planDir(again, p.uid)))) refused.add(k);
    }
    if (!refused.size) break;
  }
  yield* placeTokensSteps(m, ps);
}

/** Board summons back to their hand stacks (or a free hand slot). */
function liftTokens(ps) {
  for (const p of [...ps.board.values()]) {
    if (p.kind !== 'token') continue;
    const stack = ps.hand.findIndex((x) => x && x.kind === 'token' && x.ownerUid === p.ownerUid && x.id === p.id);
    const idx = stack >= 0 ? stack : freeSlot(ps.hand);
    if (idx >= 0) tryDo(() => ps.move(p.uid, { area: 'hand', idx }));
  }
}

/**
 * Summons that help the operator on the tile they face (range 1-1: their own tile + the one in front) instead of
 * covering the enemy path: 凯瑟琳's 爬行号·防护单元 (a hand piece since user playtest #6).
 */
const FRONT_SUPPORT_TOKENS = new Set(['token_10041_cathy_catsld']);
/** Device tile offsets around an operator (behind it — enemies come from the gates on the right —, above, below, in front) and the facing that points back at it. */
const SUPPORT_SPOTS = Object.freeze([[0, -1, 'RIGHT'], [1, 0, 'DOWN'], [-1, 0, 'UP'], [0, 1, 'LEFT']]);

/**
 * A tile + direction for a front-support device: next to the most valuable operator no device faces yet (blockers
 * first — they take the hits —, then DPS), pointing at it; null when none is free.
 */
function supportSpot(m, ps, p) {
  const rec = (ps.gd || m.gd).token(p.id);
  if (!rec) return null;
  const map = ps.deployMap();
  const pos = positionClass(rec);
  const faced = new Set();
  for (const [k, q] of ps.board) {
    if (q.kind !== 'token' || !FRONT_SUPPORT_TOKENS.has(q.id)) continue;
    const [r, c] = parseKey(k);
    const [dr, dc] = rotateOffset(0, 1, pieceDir(q));
    faced.add(tileKey(r + dr, c + dc));
  }
  const ops = [...ps.board.entries()].filter(([k, q]) => q.kind === 'chess' && !faced.has(k)).map(([k, q]) => [k, (ps.gd || m.gd).chess(q.id)]).filter(([, c]) => c)
    .sort((a, b) => Number(isBlocker(b[1])) - Number(isBlocker(a[1])) || dpsOf(b[1]) - dpsOf(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [k] of ops) {
    const [r, c] = parseKey(k);
    for (const [dr, dc, dir] of SUPPORT_SPOTS) {
      const t = tileKey(r + dr, c + dc);
      if (!ps.board.has(t) && canPlace(map, pos, r + dr, c + dc)) return [r + dr, c + dc, dir];
    }
  }
  return null;
}

/** Tiles a summon placement tries before giving up (a refused tile is skipped and the next best one taken). */
const SUMMON_TRIES = 4;

/**
 * Placeable summons from the hand / temp onto the best free tiles (one per stack count). The server's g.move decides
 * legality: a refused tile is excluded and the next best one tried (SUMMON_TRIES).
 */
function* placeTokensSteps(m, ps) {
  for (const p of [...ps.hand, ...ps.temp]) {
    if (!p || p.kind !== 'token') continue;
    for (let n = p.count || 1; n > 0; n--) {
      yield;
      if (FRONT_SUPPORT_TOKENS.has(p.id)) {
        const spot = supportSpot(m, ps, p);
        if (!spot || !tryDo(() => ps.move(p.uid, { area: 'board', row: spot[0], col: spot[1] }, spot[2]))) break;
        continue;
      }
      const refused = new Set();
      let placed = false;
      for (let t = 0; t < SUMMON_TRIES && !placed; t++) {
        const plan = yield* planLayoutSteps(m, ps, [p], LAYOUT_PARAMS, { occupied: new Set([...ps.board.keys(), ...refused]) });
        const k = plan.get(p.uid);
        if (!k) break;
        const [r, c] = parseKey(k);
        if (tryDo(() => ps.move(p.uid, { area: 'board', row: r, col: c }, planDir(plan, p.uid)))) placed = true;
        else refused.add(k);
      }
      if (!placed) break;
    }
  }
}

/** Free equip slots under the room's morph policy. Official numbers stay items.length versus equipPerChess. */
function slotFree(m, ps, p, incoming = null) {
  const gd = ps?.gd || m.gd;
  const policy = morphSlotPolicy(ruleOption(m?.rules, 'morphPairing'), (it) => !!gd.item(it?.id)?.canGiveBond);
  const items = p?.items || [];
  return policy.accepts(items, incoming) && (!policy.occupies(incoming) || policy.slotsUsed(items) < policy.slotCap(gd.equipPerChess));
}

/** What an item does: the key of its first buff (data/items.json `buffs`, e.g. use_equip_reward_char_chess). */
const itemEffect = (rec) => (rec && Array.isArray(rec.buffs) && rec.buffs[0] && typeof rec.buffs[0].key === 'string' ? rec.buffs[0].key : '');

/** 突变细胞 (buff char_chess_transformation_equip). */
const isMutationCell = (gd, itemId) => itemEffect(gd.item(itemId)) === 'char_chess_transformation_equip';

/**
 * Whom the bot injects with 突变细胞 (after the battle its carrier — deployed or on the bench: every owned carrier's item
 * hooks run — is destroyed and a random operator one tier higher joins the bench, PlayerState.transformChess; the next
 * prep's lineup step deploys it like any owned unit, so a deployed carrier only costs a re-placement): the least
 * valuable normal operator below 6阶 with a free equip slot — never an elite, never one of a merge pair (the merge
 * progress would be lost), nobody already carrying a cell. null: the cell waits in the hand.
 */
export function cellTarget(m, ps, ctx = context(m, ps)) {
  const gd = ps?.gd || m.gd;
  let best = null;
  let bestV = Infinity;
  for (const p of ps.allChess()) {
    if (gd.isGolden(p.id) || gd.tierOf(p.id) >= 6 || !slotFree(m, ps, p)) continue;
    if ((p.items || []).some((it) => isMutationCell(gd, it.id)) || (ctx.copies.get(gd.baseIdOf(p.id)) || 0) >= 2) continue;
    const v = pieceValue(m, ps, p, ctx);
    if (v < bestV || (v === bestV && p.uid < best.uid)) { bestV = v; best = p; }
  }
  return best;
}

/** Whether the bot's own last battle was perfect (no counted leak). */
function lastPerfect(m, ps) {
  const r = m.lastResults && m.lastResults.get(ps.playerId);
  return !!r && r.perfect !== false && !(r.leaked || []).some((l) => l && l.counted !== false);
}

/**
 * The carrier of an item (null = keep it), by what the item does (itemEffect):
 *   信标 (destroys its carrier for a pick of two chess of the same tier): the highest-tier bench single, else the
 *     weakest normal deployed operator;
 *   拟态物质 (a third copy of a pair, else a member of a bond): a pair (highest tier), else a focus member — never one
 *     of 2 copies whose pool is out (the item gives nothing then);
 *   博士投影 (promotes to elite; the normal one at the next round start, the golden one at once): the strongest normal
 *     deployed operator;
 *   突变细胞 (the carrier becomes a random tier + 1 operator after the battle): cellTarget;
 *   随身身份牌 / 简易通讯机 / 寻呼模块 (act on the carrier's bonds): the operator whose bonds matter most (focus first);
 *   funds, 紧急调度券, 人事部文档 …: anyone, one with a free slot first (on a full carrier the item replaces one of its
 *     items, GitHub #263); a bond signature item (requiresBondId): a member of that bond;
 *   other equipment: the strongest deployed damage dealers with a free slot (SURVIVAL items blockers first).
 */
export function itemTarget(m, ps, item, ctx = context(m, ps), usePlan = true) {
  const gd = ps?.gd || m.gd;
  const rec = gd.item(item.id);
  if (!rec) return null;
  const planned = usePlan ? advisorPlan(m, ps)?.items : null;
  if (planContains(m, planned?.keep, item.id)) return null;
  const equip = planned?.equip?.find(e => e.id === item.id);
  const preferred = equip && ps.allChess().find(p => gd.baseIdOf(equip.target) === gd.baseIdOf(p.id) && slotFree(m, ps, p, rec));
  if (preferred) return preferred;
  const key = itemEffect(rec);
  const value = new Map();
  const val = (p) => { if (!value.has(p.uid)) value.set(p.uid, pieceValue(m, ps, p, ctx)); return value.get(p.uid); };
  const deployed = [...ps.board.values()].filter((p) => p.kind === 'chess');
  const owned = ps.allChess();
  const normal = (p) => !gd.isGolden(p.id);
  const byVal = (list, dir = -1) => list.slice().sort((a, b) => dir * (val(a) - val(b)) || a.uid - b.uid);
  const rel = (p) => { let r = 0; for (const b of chessRec(m, p.id, ps)?.bonds || []) r += b === ctx.focus ? 3 : b === ctx.second ? 2 : ps.bonds[b] && ps.bonds[b].active ? 1 : 0; return r; };
  switch (key) {
    case 'use_equip_recruit_new_char_and_give_char_to_player_most_bond': {
      // a bench single of the highest tier (a pick of two of its tier), else the weakest deployed normal operator
      const counts = copyCounts(m, ps);
      const bench = owned.filter((p) => normal(p) && ps.find(p.uid)?.area !== 'board' && (counts.get(gd.baseIdOf(p.id)) || 0) < 2)
        .sort((a, b) => (chessRec(m, b.id, ps)?.tier || 0) - (chessRec(m, a.id, ps)?.tier || 0) || val(a) - val(b) || a.uid - b.uid);
      return bench[0] || byVal(deployed.filter(normal), 1)[0] || null;
    }
    case 'use_equip_reward_char_chess': {
      // with 2 copies owned and none left in the pool the item gives nothing (GitHub #207): such a pair is no carrier
      const counts = copyCounts(m, ps);
      const live = (base) => { const pool = typeof ps.poolOf === 'function' ? ps.poolOf(base) : m.pool; return pool.left(base) > 0 || !pool.has(base); };
      const dead = (p) => (counts.get(gd.baseIdOf(p.id)) || 0) >= 2 && !live(gd.baseIdOf(p.id));
      const pair = owned.filter((p) => normal(p) && !dead(p) && (counts.get(gd.baseIdOf(p.id)) || 0) + 1 >= mergeNeed(m, gd.baseIdOf(p.id)))
        .sort((a, b) => (chessRec(m, b.id, ps)?.tier || 0) - (chessRec(m, a.id, ps)?.tier || 0) || a.uid - b.uid);
      return pair[0] || owned.filter((p) => !dead(p)).sort((a, b) => rel(b) - rel(a) || val(b) - val(a) || a.uid - b.uid)[0] || null;
    }
    // 博士投影: the normal one promotes at the next round start, the golden one (缪尔赛思's R1 item, item merges) at once;
    // both refuse an elite (builtinMeta: BAD_TARGET 'already elite')
    case 'equip_round_start_upgrade_char':
    case 'use_equip_upgrade_char':
      return byVal(deployed.filter(normal))[0] || byVal(owned.filter(normal))[0] || null;
    case 'char_chess_transformation_equip':
      return cellTarget(m, ps, ctx);
    case 'use_equip_reward_char_chess_bond_layer':
    case 'use_equip_reward_char_chess_with_same_bond':
    case 'use_equip_reward_special_goods_char_chess':
      return owned.slice().sort((a, b) => rel(b) - rel(a) || val(b) - val(a) || a.uid - b.uid)[0] || null;
    default:
      break;
  }
  const consume = typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip');
  const list = byVal(deployed);
  const free = (p) => slotFree(m, ps, p, rec);
  // a consumable on a full carrier destroys one of its items (the replace rule, GitHub #263): a carrier with a free slot
  // first — the effect is the same on anyone
  if (consume) return list.find(free) || owned.find(free) || list[0] || owned[0] || null;
  if (rec.requiresBondId) {
    const member = list.find((p) => free(p) && (chessRec(m, p.id, ps)?.bonds || []).includes(rec.requiresBondId));
    if (member) return member;
  }
  // damage dealers carry equipment first (healers / non-attackers last); survival items on blockers first
  const dealer = (p) => { const c = chessRec(m, p.id, ps); return c && !isHealer(c) && c.attackKind !== 'none'; };
  const blocker = (p) => isBlocker(chessRec(m, p.id, ps));
  const order = rec.category === 'SURVIVAL'
    ? [...list.filter(blocker), ...list.filter((p) => !blocker(p) && dealer(p)), ...list.filter((p) => !blocker(p) && !dealer(p))]
    : [...list.filter(dealer), ...list.filter((p) => !dealer(p))];
  return order.find(free) || null;
}

/** 教鞭 / “神秘顾客”: an Art that adds a bounty to the own next battle (trap_create_self_choice). */
const isBountyArt = (gd, itemId) => { const rec = gd.item(itemId); return !!rec && Array.isArray(rec.buffs) && rec.buffs.some((b) => b && b.key === 'trap_create_self_choice'); };

/**
 * Use an Art: 画卷 copies the operator on its tile (its range is the tile + the one in front) — the most valuable
 * deployed operator, with a free hand slot for the copy; 教鞭 offers a scored personal bounty choice, “神秘顾客” adds a
 * random bounty — only after a perfect battle with LP to spare, else the Art stays in the hand for a later round
 * (destroying 教鞭 gives nothing; a full hand at the prep end: freeHandSlot).
 */
function useArt(m, ps, item, ctx) {
  const rec = m.gd.item(item.id);
  const keys = (rec && Array.isArray(rec.buffs) ? rec.buffs : []).map((b) => b && b.key);
  if (keys.includes('trap_copy_front_char')) {
    if (freeSlot(ps.hand) < 0) return;
    const best = [...ps.board.entries()].filter(([, p]) => p.kind === 'chess').sort((a, b) => pieceValue(m, ps, b[1], ctx) - pieceValue(m, ps, a[1], ctx) || a[1].uid - b[1].uid)[0];
    if (!best) return;
    const [r, c] = parseKey(best[0]);
    tryDo(() => ps.useArt(item.uid, r, c));
    return;
  }
  if (keys.includes('trap_create_self_choice')) {
    if (!lastPerfect(m, ps) || ps.lp < 10) return; // kept
    const [key] = [...ps.board.keys()];
    if (key) {
      const [r, c] = parseKey(key);
      if (tryDo(() => ps.useArt(item.uid, r, c))) m.autoPickPersonalChoice(ps, 'bot');
    }
    return;
  }
  const [key] = [...ps.board.keys()];
  if (key) { const [r, c] = parseKey(key); tryDo(() => ps.useArt(item.uid, r, c)); }
}

function equipItems(m, ps) {
  const gd = ps?.gd || m.gd;
  const tried = new Set();
  for (let guard = 0; guard < 12; guard++) {
    const item = [...ps.hand, ...ps.temp].find((p) => p && p.kind === 'item' && canUseItem(m, ps, p) && !tried.has(p.uid));
    if (!item) break;
    tried.add(item.uid);
    if (planContains(m, advisorPlan(m, ps)?.items?.keep, item.id)) continue;
    const ctx = context(m, ps);
    const rec = gd.item(item.id);
    if (rec && rec.itemType === 'MAGIC') { useArt(m, ps, item, ctx); continue; }
    const target = itemTarget(m, ps, item, ctx);
    if (!target) continue;
    if (!tryDo(() => ps.equip(item.uid, target.uid)) && advisorPlan(m, ps)?.items?.equip?.length) {
      const fallback = itemTarget(m, ps, item, ctx, false);
      if (fallback && fallback.uid !== target.uid) tryDo(() => ps.equip(item.uid, fallback.uid));
    }
  }
}

/**
 * Free a hand slot for an item worth keeping (突变细胞): sell the weakest single hand chess, else (on a bot's own seat
 * only — a human's items under AI 托管 are never destroyed to make room, like freeHandSlot) destroy the cheapest other
 * hand item, else sell the weakest hand chess even of a pair. `piece` (in temp): done once the freed slot pulled it in
 * (PlayerState._fillHandFromTemp — resolveTemp asks for the rightmost temp piece, the next one a slot pulls in). false:
 * the hand stays full (summon cards only).
 */
function makeHandRoom(m, ps, piece = null) {
  const room = () => freeSlot(ps.hand) >= 0 || (piece != null && !ps.temp.includes(piece));
  if (room()) return true;
  if (sellWeakestHand(m, ps, { handOnly: true }) && room()) return true;
  const gd = ps?.gd || m.gd;
  const junk = ps.isBot && !ps.autoplay ? ps.hand.filter((p) => p && p.kind === 'item' && !isMutationCell(gd, p.id))
    .sort((a, b) => ((gd.item(a.id) || {}).price || 0) - ((gd.item(b.id) || {}).price || 0) || a.uid - b.uid)[0] : null;
  if (junk && tryDo(() => ps.destroy(junk.uid)) && room()) return true;
  return sellWeakestHand(m, ps, { handOnly: true, keepPairs: false }) && room();
}

/**
 * Empty the temp row before Ready. A freed hand slot pulls the temp pieces in by itself, rightmost first
 * (PlayerState._fillHandFromTemp), so the pieces are decided right → left: the one at hand is always the next a freed
 * slot takes. A chess: the weakest bench single is sold to make room (it may be the temp chess itself), else the temp
 * chess is sold; an item: see below, else destroyed.
 */
export function resolveTemp(m, ps) {
  // Track pieces, not indices: draining an extended queue refills and compacts its visible window.
  for (const p of ps.tempPieces()) {
    if (!ps.temp.includes(p)) continue;
    const idx = freeSlot(ps.hand); // (a recompute pulls it in; a state set up without one)
    if (idx >= 0 && tryDo(() => ps.move(p.uid, { area: 'hand', idx }))) continue;
    if (p.kind === 'chess') {
      if (economyPlan(m, ps)) {
        // Temp auto-refills after each action. Drain cheaper alternatives before considering this piece.
        for (let guard = 0; guard < 32 && ps.temp.includes(p); guard++) {
          if (!advisorRoomStep(m, ps)) break;
        }
        if (!ps.temp.includes(p)) continue;
      }
      if (!sellWeakestHand(m, ps)) tryDo(() => ps.sell(p.uid));
    } else if (p.kind === 'item') {
      // 突变细胞 comes back after every transformation (昆图斯's strategy item), and a human's item under AI 托管 is theirs:
      // make room in the hand (sell a bench operator) rather than lose it — only a hand of nothing but items still drops it
      if ((isMutationCell(m.gd, p.id) || ps.autoplay) && makeHandRoom(m, ps, p)) {
        if (!ps.temp.includes(p)) continue;
        const j = freeSlot(ps.hand);
        if (j >= 0 && tryDo(() => ps.move(p.uid, { area: 'hand', idx: j }))) continue;
      }
      tryDo(() => ps.destroy(p.uid));
    }
  }
  // anything left (e.g. sells failed): final sweep — tokens cannot be sold, they are dropped with the temp slot (and
  // come back at the next round start, PlayerState.startRound)
  for (const p of [...ps.temp]) {
    if (!p || !ps.temp.includes(p)) continue;
    if (economyPlan(m, ps) && p.kind === 'chess') {
      for (let guard = 0; guard < 32 && ps.temp.includes(p); guard++) {
        if (!advisorRoomStep(m, ps)) break;
      }
      if (!ps.temp.includes(p)) continue;
    }
    if (p.kind === 'chess') tryDo(() => ps.sell(p.uid));
    else if (p.kind === 'item') tryDo(() => ps.destroy(p.uid));
  }
  if (!ps.tempEmpty) ps.resolveTemp();
}

// Explicit operation references keep the default policy and RNG consumption unchanged.
const LEGACY_PREP_ACTIONS = Object.freeze({
  takeOffers, sellJunk, buyLoopSteps, levelUp, advisorSpendSteps, spendDown, economyPlan, maybeFreeze, arrangeSteps, equipItems,
  applyPlanSteps, resolveTemp, freeHandSlot, rememberOwned,
  hasHandRoom: (ps) => freeSlot(ps.hand) >= 0,
  ready: (ps) => tryDo(() => ps.setReady(true)),
});

/** Reuse prep scheduling with explicit operation overrides; definitions hold no per-seat state. */
export function createBotPrepSteps(actions = {}, policy = null) {
  const economic = policy ? {
    // [ASSUMED] Ioleta owns its refresh budget; legacy/adaptive retain the expiring-fund sweep.
    spendDown: () => {},
    takeOffers: (m, ps) => takeOffers(m, ps, policy),
    sellJunk: (m, ps) => sellJunk(m, ps, policy),
    buyLoopSteps: (m, ps, opts) => buyLoopSteps(m, ps, { ...opts, policy }),
    levelUp: (m, ps, opts) => levelUp(m, ps, { ...opts, policy }),
    maybeFreeze: (m, ps) => maybeFreeze(m, ps, policy),
  } : {};
  return createPrepSteps({ ...LEGACY_PREP_ACTIONS, ...economic, ...actions },
    { maxRefreshes: MAX_REFRESHES, arrangeBeforeLevel: !!policy });
}

const LEGACY_PREP = createBotPrepSteps();
