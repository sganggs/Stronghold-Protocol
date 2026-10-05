// Pure in-match UI logic (no DOM, no Preact) — unit-tested in Node (test/ui/*.test.js).
//
// Placement legality (`canPlace`) mirrors the server rules of DESIGN §3/§6.2 so the render view can
// light legal tiles while dragging; the server stays authoritative and may still refuse a move.
//
//   Board = own normal field (GEO.FIELD rows 9–12, cols 2–10). Melee chess stand on `melee` deploy tiles
//   (LOW, buildable ALL/MELEE) — elite 歌蕾蒂娅 carrying HOK-Y (shared/highGround.js, the player's loadout) on any
//   deploy tile, the 高台 included (piecePosition 'ALL'); ranged chess on `melee ∪ rangedOnly` (stages.json → deployTiles.normal,
//   derived from the tile legend when missing — the legend's `buildable` is the effective type: 深水区 tile_deepsea
//   refuses deployment, PRTS 深水区 地形信息 "拒绝部署（待补充）", player report #3 after 0.1.0). Tokens follow their
//   own `position`; a summon whose text reads "只能部署在召唤者攻击范围内" (tokens.json `ownerRange`: 伺夜's 狼群,
//   缪尔赛思's 流形) also needs a tile of its owner's attack range (`summonRange`, player report #9). In the prep of a
//   boss round (最终攻势 / 隐秘核心) the tiles are the player's half of the boss field (`deployFieldOf`: 'bossL' /
//   mirrored 'bossR', board (r, c) = stage tile (r − 7, c) / (r − 7, 20 − c)) like the server's deploy map
//   (server/match/board.js field; user playtest #5 item 7) — board coordinates stay the same.
//   Hand = 10 slots (index = col). Temp slots are server-filled only (no move target).
//   Dropping onto an occupied tile/slot swaps (both pieces must be legal at their new spots);
//   an EQUIP item dropped onto a chess piece equips it (tokens can't carry items); an Arts (MAGIC) item
//   dropped on a field tile is used there (g.art). Deploy cap counts chess pieces on the board only
//   (summons don't use a slot, research 00 §8 #11). Only PREP, alive and not-ready players may edit.
//   A board piece dropped on its own tile is legal ('orient'): the direction wheel re-orients it in place
//   (research 09 §1.2); board drops of units go through the wheel before g.move {uid, to, dir} (ui/facing.js).

import { GEO, PHASE, UF } from '../../../shared/constants.js';
import { resolveLoadout, loadoutOptions, MODULE_NONE } from '../../../shared/protocol.js';
import { resolveRecordLoadout, loadoutRecord, attackRangeGrid } from '../../../shared/loadoutRecord.js';
import { meleeOnHighGround } from '../../../shared/highGround.js';
import { rangeTiles, pieceDir } from './facing.js';
import { layoutPen } from '../render/pen.js';
import { BOSS_ROW_SHIFT, MAX_COL } from '../render/prepfield.js';
import { bossLevelSeconds } from './matchStatus.js';

// ---- small helpers -------------------------------------------------------------------------------

const isObj = (v) => !!v && typeof v === 'object';
const int = (v, d = 0) => (Number.isInteger(v) ? v : d);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Stable key of a board tile. */
export const tileKey = (row, col) => `${row},${col}`;

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
 * Camera of the own prep board (research 09 §1.2 "Final Assault, right side", DESIGN §15): in the prep of a boss round
 * (最终攻势 / 隐秘核心: `pub.round` is `bossRound` or `hiddenRound`) the pieces stand on the player's half of the shared
 * boss field — `{ kind: 'bossPrep', opts: { side } }`; the side follows the server's pairing (server/match/
 * finalAssault.js pairPlayers: the alive players in seat order, two by two; the second of a pair is on the mirrored
 * right half 'R', a lone player on 'L'). Any other prep: the own board `{ kind: 'prep', opts: { rect, side: 'L' } }`.
 * @param {any} pub m.public
 * @param {string|null} myId
 * @returns {{ kind: 'prep'|'bossPrep', opts: { rect?: { r0: number, r1: number, c0: number, c1: number }, side: 'L'|'R' } }}
 */
export function prepCamera(pub, myId) {
  const normal = { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L' } };
  const r = pub?.round;
  if (!Number.isInteger(r) || r <= 0 || !(r === pub.bossRound || r === pub.hiddenRound)) return normal;
  const alive = (Array.isArray(pub.players) ? pub.players : []).filter((p) => isObj(p) && p.alive !== false)
    .sort((a, b) => int(a.seat, 99) - int(b.seat, 99));
  const idx = alive.findIndex((p) => p.playerId === myId);
  if (idx < 0) return normal; // eliminated / unknown: no board of its own on the boss field
  return { kind: 'bossPrep', opts: { side: idx % 2 === 1 ? 'R' : 'L' } };
}

/**
 * The own prep board's camera request with the shop bar's state (public issue #5 "准备阶段，收起商店界面时，界面并不会进行
 * 缩放"): `prepCamera` plus `shop: !folded` — a folded shop (收起) takes the official shop-collapsed camera
 * (configBlackBoard left_prepare_camera_param / *_boss_prepare_*, render/projection.js presetCamera `shop: false`) and
 * the folded shop's HUD band (ui/fieldHost.js hudBands), an open one the shop camera. `folded` = the shop bar is shown
 * and folded (an eliminated player's board, which shows no bar, keeps the shop camera).
 * @returns {{ kind: 'prep'|'bossPrep', opts: { rect?: object, side: 'L'|'R', shop: boolean } }}
 */
export function prepCameraFor(pub, myId, folded = false) {
  const c = prepCamera(pub, myId);
  return { kind: c.kind, opts: { ...c.opts, shop: !folded } };
}

/**
 * The camera request a fold / unfold of the shop bar needs right now (public issue #5), or null: only while the own prep
 * board is on screen (`ownPrep`: prep, not a teammate's scouted board, not a battle), never over the enemy pen (`pen`: it
 * folds the shop itself and returns to the camera it left), deferred while a piece is dragged or its direction is chosen
 * (`busy`: the drop target and the wheel sit on tiles of the camera in use — the caller asks again once that ends), and
 * nothing when the current request (`current` { kind, opts }) already has that shop state.
 * @param {{ pub: any, myId: string|null, ownPrep: boolean, folded: boolean, pen?: boolean, busy?: boolean,
 *   current?: { kind: string, opts?: { shop?: boolean } }|null }} s
 * @returns {{ kind: 'prep'|'bossPrep', opts: object }|null}
 */
export function foldCamera(s) {
  if (!s || !s.ownPrep || s.pen || s.busy) return null;
  const want = prepCameraFor(s.pub, s.myId, !!s.folded);
  const cur = s.current;
  if (cur && cur.kind === want.kind && (cur.opts?.shop !== false) === want.opts.shop) return null;
  return want;
}

/**
 * The field the own pieces are deployed on (server/match/Match.js deployFieldOf): 'bossL' / 'bossR' in the prep of a
 * boss round (the same pairing as `prepCamera`), else 'normal'. Placement legality (`placementContext` → `deployMap`
 * with `field`) reads that field's tiles.
 * @returns {'normal'|'bossL'|'bossR'}
 */
export function deployFieldOf(pub, myId) {
  const cam = prepCamera(pub, myId);
  return cam.kind === 'bossPrep' ? (cam.opts.side === 'R' ? 'bossR' : 'bossL') : 'normal';
}

/**
 * The stage tile [row, col] of board tile (r, c) on deploy field `field` (server/match/board.js fieldTile): the boss
 * prep's display transform (render/prepfield.js bossPrepField: row − 7, the right half mirrored col c → 20 − c).
 */
export function fieldTile(field, r, c) {
  if (field !== 'bossL' && field !== 'bossR') return [r, c];
  return [r + BOSS_ROW_SHIFT, field === 'bossR' ? MAX_COL - c : c];
}

/** The board tile of stage tile (r, c) on deploy field `field` (server/match/board.js boardTileOf). */
export function boardTileOf(field, r, c) {
  if (field !== 'bossL' && field !== 'bossR') return [r, c];
  return [r - BOSS_ROW_SHIFT, field === 'bossR' ? MAX_COL - c : c];
}

/** The band (策略) a player picked, from m.public.players[].bandId (Match.js marksPublic) — the detail card shows it
 *   on a teammate's unit (user playtest #2 item 2: watching a teammate revealed nothing about their 策略). */
export function ownerBandId(pub, ownerId) {
  const p = Array.isArray(pub?.players) ? pub.players.find((x) => x && x.playerId === ownerId) : null;
  return typeof p?.bandId === 'string' && p.bandId ? p.bandId : null;
}

/** Banner shown when a phase starts: { title, sub?, tone } or null. */
export function phaseBanner(phase, pub) {
  const r = int(pub?.round, 0);
  switch (phase) {
    case PHASE.BATTLE_CHECK: return { title: '协议启动', micro: 'PROTOCOL START', tone: 'mint', sub: '模拟即将开始', duration: 2600 };
    case PHASE.ROUND_START: return { title: `第 ${r} 回合`, micro: `ROUND ${String(r).padStart(2, '0')}`, tone: 'mint', sub: '资金已到账' };
    case PHASE.SP_DRAFT: return { title: '机变阶段', micro: 'CONTINGENCY', tone: 'gold', sub: '依次选择机变' };
    case PHASE.PREP: return { title: '休整期', micro: `ROUND ${String(r).padStart(2, '0')} // REST`, tone: 'mint', sub: '部署干员，准备迎敌' };
    case PHASE.COMBAT: return { title: '作战开始', micro: 'COMBAT', tone: 'orange', sub: '各自行动阶段' };
    case PHASE.UNITE: {
      const names = new Map(sortedPlayers(pub).map((p) => [p.playerId, p.name || '博士']));
      const helpers = Array.isArray(pub?.unite?.helpers) ? pub.unite.helpers.map((id) => names.get(id)).filter(Boolean) : [];
      return { title: '联防阶段', micro: 'JOINT DEFENSE', tone: 'orange', sub: helpers.length ? `联防：${helpers.join('、')}` : '完美作战的博士迎战突破防线的敌人' };
    }
    case PHASE.FINAL_ASSAULT: return { title: '最终攻势', micro: 'FINAL ASSAULT', tone: 'red', sub: '击败敌方领袖' };
    case PHASE.HIDDEN_CORE: return { title: '隐秘核心', micro: 'HIDDEN CORE', tone: 'red', sub: '被源石侵蚀的假想敌' };
    case PHASE.SETTLE: return null;
    default: return null;
  }
}

/** Label of the prep capsule ("休息一下" in the original). */
export function prepCapsuleLabel(phase) {
  if (phase === PHASE.SP_DRAFT) return '机变阶段';
  if (phase === PHASE.ROUND_START) return '回合开始';
  if (phase === PHASE.BATTLE_CHECK) return '协议启动';
  if (phase === PHASE.SETTLE) return '回合结算';
  return '休息一下';
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

// ---- players, statuses, fields ------------------------------------------------------------------------

/** Status → glyph + text (research 06 §11.1). */
export const STATUS_META = Object.freeze({
  acting: { glyph: 'dots', text: '行动中', tone: 'lo' },
  ready: { glyph: 'check', text: '已就绪', tone: 'mint' },
  deciding: { glyph: 'hourglass', text: '决策中', tone: 'gold' },
  combat: { glyph: 'sword', text: '作战中', tone: 'orange' },
  done: { glyph: 'check', text: '作战结束', tone: 'mint' },
  helping: { glyph: 'shield', text: '联防中', tone: 'orange' },
  left: { glyph: 'exit', text: '已离开', tone: 'red' },
  dead: { glyph: 'close', text: '已淘汰', tone: 'red' },
});

/** Players sorted by seat (nulls dropped). */
export function sortedPlayers(pub) {
  const list = Array.isArray(pub?.players) ? pub.players.filter(isObj) : [];
  return [...list].sort((a, b) => int(a.seat, 99) - int(b.seat, 99));
}

/** Own normal field id (DESIGN §8.3). */
export const ownFieldId = (playerId) => `n:${playerId}`;

/**
 * Field the player sits in right now (own normal field, or the unite/boss field that lists them).
 * @param {any} pub
 * @param {string} playerId
 */
export function homeFieldId(pub, playerId) {
  const fields = Array.isArray(pub?.fields) ? pub.fields : [];
  const special = fields.find((f) => isObj(f) && f.kind !== 'normal' && Array.isArray(f.players) && f.players.includes(playerId) && f.live !== false);
  if (special) return special.fieldId;
  const me = sortedPlayers(pub).find((p) => p.playerId === playerId);
  if (me && typeof me.fieldId === 'string' && me.fieldId) return me.fieldId;
  return ownFieldId(playerId);
}

/**
 * Next/previous watchable field for the ‹ › view switcher.
 * @param {Array<{fieldId:string, live?:boolean}>} fields
 * @param {string|null} current
 * @param {1|-1} dir
 * @returns {string|null}
 */
export function cycleField(fields, current, dir = 1) {
  const list = (Array.isArray(fields) ? fields : []).filter((f) => isObj(f) && typeof f.fieldId === 'string' && f.live !== false);
  if (list.length === 0) return null;
  const i = list.findIndex((f) => f.fieldId === current);
  if (i < 0) return list[0].fieldId;
  const n = list.length;
  return list[(((i + dir) % n) + n) % n].fieldId;
}

/**
 * What clicking a teammate row asks the server to watch, or why it can't (mirror of server Match.watch): an
 * eliminated player has no board to watch, and during 最终攻势 / 隐秘核心 a fighting player can't see the other
 * pair's boss field ("无法查看另一组队友的战场情况").
 * @param {any} p m.public player row
 * @param {any} pub
 * @param {string} myId
 * @returns {{ fieldId: string } | { reason: string }}
 */
export function watchTarget(p, pub, myId) {
  if (!isObj(p)) return { reason: '无效的目标' };
  if (p.alive === false) return { reason: '该队友已被淘汰，无法查看其阵地' };
  const combat = isCombatPhase(pub?.phase);
  const fieldId = (combat && typeof p.fieldId === 'string' && p.fieldId) || ownFieldId(p.playerId);
  if (combat) {
    const fields = Array.isArray(pub?.fields) ? pub.fields.filter(isObj) : [];
    const f = fields.find((x) => x.fieldId === fieldId);
    const me = sortedPlayers(pub).find((x) => x.playerId === myId);
    const mine = fields.find((x) => Array.isArray(x.players) && x.players.includes(myId));
    if (f && (f.kind === 'boss' || f.kind === 'hidden') && me?.alive !== false && mine && mine.fieldId !== f.fieldId) {
      return { reason: '无法查看另一组队友的战场' };
    }
  }
  return { fieldId };
}

/**
 * Label of the ‹ › view switcher: the watched field (also one whose battle already ended), else the own field —
 * or, for an eliminated spectator (no own field), the watched player / 观战.
 * @param {any} pub
 * @param {string|null} watching fieldId on screen
 * @param {string} myId
 * @param {boolean} [spectating]
 */
export function switcherLabel(pub, watching, myId, spectating = false) {
  const fields = (Array.isArray(pub?.fields) ? pub.fields : []).filter(isObj);
  const cur = fields.find((f) => f.fieldId === watching);
  if (cur) return fieldLabel(cur, pub, myId);
  if (typeof watching === 'string' && watching.startsWith('n:') && watching !== ownFieldId(myId)) {
    return sortedPlayers(pub).find((p) => p.playerId === watching.slice(2))?.name || '队友';
  }
  return spectating ? '观战' : '自己';
}

/**
 * Human label of a field for the view switcher.
 * @param {any} field { fieldId, kind, players }
 * @param {any} pub
 * @param {string} myId
 */
export function fieldLabel(field, pub, myId) {
  if (!isObj(field)) return '—';
  const names = new Map(sortedPlayers(pub).map((p) => [p.playerId, p.name || '博士']));
  const ps = Array.isArray(field.players) ? field.players : [];
  if (field.kind === 'unite') return ps.includes(myId) ? '联防（自己）' : '联防阵地';
  if (field.kind === 'boss' || field.kind === 'hidden') {
    if (ps.includes(myId)) return ps.length > 1 ? '全景' : '自己';
    return ps.map((id) => names.get(id) || '博士').join(' · ') || '领袖战场';
  }
  if (ps.includes(myId) || field.fieldId === ownFieldId(myId)) return '自己';
  const id = ps[0] ?? String(field.fieldId || '').replace(/^n:/, '');
  return names.get(id) || '队友';
}

/**
 * Active emote bubbles: playerId → { id, seq, at } for emotes younger than ttl.
 * @param {Array<{seq:number, playerId:string, id:string, at:number}>} emotes
 * @param {number} now
 * @param {number} [ttl]
 */
export function activeBubbles(emotes, now, ttl = 3000) {
  const out = new Map();
  for (const e of Array.isArray(emotes) ? emotes : []) {
    if (!isObj(e) || !(now - e.at < ttl) || e.at > now + 1000) continue;
    const cur = out.get(e.playerId);
    if (!cur || cur.seq < e.seq) out.set(e.playerId, { id: e.id, seq: e.seq, at: e.at });
  }
  return out;
}

// ---- bonds -------------------------------------------------------------------------------------------

/**
 * Sort bonds for the strip: active first, then layers desc, count desc, tier desc, core first, id; the mode-off bonds
 * (`off`: the server's entries for the bonds this mode never activates that the player has members of —
 * server/match/bondsMeta.js offBondCounts) after all the others.
 * @template {{bondId:string, active?:boolean, layers?:number, count?:number, tier?:number, off?:boolean}} B
 * @param {B[]} bonds
 * @param {(id:string)=>any} [getBond]
 * @returns {B[]}
 */
export function sortBonds(bonds, getBond = () => null) {
  const list = (Array.isArray(bonds) ? bonds : []).filter((b) => isObj(b) && typeof b.bondId === 'string');
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return [...list].sort((a, b) => (
    (a.off ? 1 : 0) - (b.off ? 1 : 0)
    || (b.active ? 1 : 0) - (a.active ? 1 : 0)
    || n(b.layers) - n(a.layers)
    || n(b.count) - n(a.count)
    || n(b.tier) - n(a.tier)
    || (getBond(b.bondId)?.isCore ? 1 : 0) - (getBond(a.bondId)?.isCore ? 1 : 0)
    || (a.bondId < b.bondId ? -1 : a.bondId > b.bondId ? 1 : 0)
  ));
}

/**
 * Tier reached for a member count against ascending thresholds (downward bonds: active while count ≤ max).
 * @param {number} count
 * @param {number[]} thresholds
 * @param {number|null} [maxCount]
 */
export function bondTier(count, thresholds, maxCount = null) {
  const c = Number.isFinite(count) ? count : 0;
  if (Number.isFinite(maxCount) && c > maxCount) return 0;
  let t = 0;
  for (const th of Array.isArray(thresholds) ? thresholds : []) if (c >= th) t += 1;
  return t;
}

/** Next threshold above the count, or null when maxed. */
export function nextThreshold(count, thresholds) {
  for (const th of Array.isArray(thresholds) ? thresholds : []) if (count < th) return th;
  return null;
}

/**
 * Bonds granted by 变形同构体: an item with `canGiveBond` worn together with an item that has a `giveBondId` makes the
 * wearer a member of that other item's bond (band 变形者集群 "与特定装备一同装备时装备者将视为特定盟约成员"; the item's
 * talent, character_table trap_1073_acarm073, lists the 14 pairings). The same rule as the server's count
 * (server/match/bondsMeta.js pieceBonds) and the battle's (server/sim/content/support unitBonds).
 * @param {Array<string|{id:string}>|null|undefined} items the carried items (ids or { id } pieces)
 * @param {(id:string)=>any} [getItem] items.json lookup
 * @returns {string[]}
 */
export function grantedBonds(items, getItem = () => null) {
  const list = Array.isArray(items) ? items : [];
  if (list.length < 2) return [];
  const recs = list.map((it) => getItem(typeof it === 'string' ? it : it?.id)).filter(isObj);
  if (!recs.some((r) => r.canGiveBond)) return [];
  const out = [];
  for (const r of recs) if (!r.canGiveBond && typeof r.giveBondId === 'string' && r.giveBondId && !out.includes(r.giveBondId)) out.push(r.giveBondId);
  return out;
}

/**
 * A chess piece's bonds: its record's + those its 变形同构体 pairing grants (grantedBonds) — the detail card's chips.
 * @param {any} chess chess.json record @param {Array<string|{id:string}>|null|undefined} items @param {(id:string)=>any} [getItem]
 * @returns {string[]}
 */
export function pieceBondIds(chess, items, getItem = () => null) {
  const out = (Array.isArray(chess?.bonds) ? chess.bonds : []).filter((b) => typeof b === 'string');
  for (const b of grantedBonds(items, getItem)) if (!out.includes(b)) out.push(b);
  return out;
}

/**
 * The 变形同构体 pairings — the list its 天赋栏 shows (the item text: "具体对应关系可在模拟中查看本装备天赋栏"; character_table
 * trap_1073_acarm073 "“炎国短刀”→【炎】盟约 …", 14 bonds; GitHub issue #1: without it the item read as doing nothing).
 * Built from the same `giveBondId` the server counts with (server/match/bondsMeta.js pieceBonds, grantedBonds here): every
 * bond an item grants, in bonds.json order, with the items that grant it (one entry per item family — the normal and 进阶
 * copies share a name —, by tier, then data order). `off`: the mode never activates the bond (modeOffBonds: 本局禁用 — 标准
 * leaves 5 of the 14 off). `worn`: the wearer's items (`carried`, the card shows the 变形同构体 on an operator) pair it with
 * one of the bond's items — the pairing in effect on that operator (that item `worn` too).
 * @param {Iterable<any>} itemRecs items.json records (data.list('items'))
 * @param {Iterable<any>} bondRecs bonds.json records in data order (data.list('bonds'))
 * @param {{ off?: Set<string>|null, carried?: Array<string|{id:string}>|null }} [opts]
 * @returns {Array<{ bondId: string, name: string, off: boolean, worn: boolean, items: Array<{ id: string, name: string, worn: boolean }> }>}
 */
export function morphPairings(itemRecs, bondRecs, { off = null, carried = null } = {}) {
  const recs = [...(itemRecs || [])].filter(isObj);
  const byId = new Map(recs.map((r) => [r.id, r]));
  const getItem = (id) => byId.get(id) || null;
  const worn = new Set(grantedBonds(carried, getItem));
  const carriedIds = new Set((Array.isArray(carried) ? carried : []).map((it) => (typeof it === 'string' ? it : it?.id)).filter((x) => typeof x === 'string'));
  const famOf = (r) => (typeof r.baseId === 'string' && r.baseId ? r.baseId : r.id);
  /** bondId → family id → { id, name, tier, order, ids } */
  const groups = new Map();
  recs.forEach((r, order) => {
    if (r.canGiveBond || typeof r.giveBondId !== 'string' || !r.giveBondId) return;
    let g = groups.get(r.giveBondId);
    if (!g) groups.set(r.giveBondId, (g = new Map()));
    const fam = famOf(r);
    const e = g.get(fam);
    if (e) { e.ids.push(r.id); return; }
    g.set(fam, { id: fam, name: typeof r.name === 'string' && r.name ? r.name : fam, tier: int(r.tier, 99), order, ids: [r.id] });
  });
  const out = [];
  for (const b of bondRecs || []) {
    const g = isObj(b) ? groups.get(b.bondId) : null;
    if (!g) continue;
    const bondWorn = worn.has(b.bondId);
    const items = [...g.values()].sort((x, y) => (x.tier - y.tier) || (x.order - y.order))
      .map((e) => ({ id: e.id, name: e.name, worn: bondWorn && e.ids.some((id) => carriedIds.has(id)) }));
    out.push({ bondId: b.bondId, name: typeof b.name === 'string' && b.name ? b.name : b.bondId, off: !!(off && typeof off.has === 'function' && off.has(b.bondId)), worn: bondWorn, items });
  }
  return out;
}

/**
 * Bond id of 调和 (bonds.json maniShip, "激活时使场上核心盟约的激活人数+1") — server/match/bondsMeta.js HARMONY_BOND; a test
 * pins the two. Only to name the 调和 operators: whether a bond's count holds the +1 is the server's word (the view
 * entry's `harmony`, DESIGN §21.26).
 */
export const HARMONY_BOND = 'maniShip';

/**
 * The 调和 operators on a board, distinct (normal and elite copies of one operator once): who activates the +1 a bond
 * entry's `harmony` reports (the bond popup's 调和 row names them — 缪尔赛思, the Pith strategy's 盟约·辅助干员).
 * @param {any} priv m.private — or a teammate's field operators (ui/watchBonds.js ownerBoard)
 * @param {(id:string)=>any} [getChess]
 * @returns {Array<{ id: string, name: string }>} base chess ids
 */
export function harmonyMembers(priv, getChess = () => null) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(priv?.board) ? priv.board : []) {
    if (p?.kind !== 'chess') continue;
    const c = getChess(p.id);
    if (!Array.isArray(c?.bonds) || !c.bonds.includes(HARMONY_BOND)) continue;
    const base = c.baseId || (typeof p.id === 'string' ? p.id.replace(/_b$/, '_a') : p.id);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({ id: base, name: getChess(base)?.name || c.name || base });
  }
  return out;
}

/**
 * Member rows of a bond popup: every visible member with owned / on-board / in-hand / banned state, plus the player's
 * operators that are members through 变形同构体 (grantedBonds; `granted: true` and `items`: the item ids of the copy that
 * wears the pair — the card the row opens shows them; one row per operator — normal and elite copies are one member,
 * like the count's distinct members), so "成员 x/y" agrees with the count the server reports (在场; memberHeadCount).
 * `inHand`: in the 整备区 (hand), not the 5 temporary slots — what BOARD_AND_DECK bonds (投资人 远见 奇迹) count.
 * @param {any} bond bonds.json record
 * @param {any} priv m.private (hand/board/temp) — or a teammate's field operators (ui/watchBonds.js ownerBoard)
 * @param {Set<string>|string[]} [banned] banned base chess ids
 * @param {(id:string)=>any} [getChess]
 * @param {(id:string)=>any} [getItem] items.json lookup (the 变形同构体 pairings)
 */
export function bondMembers(bond, priv, banned = [], getChess = () => null, getItem = () => null) {
  const bannedSet = banned instanceof Set ? banned : new Set(Array.isArray(banned) ? banned : []);
  const members = Array.isArray(bond?.visibleMembers) && bond.visibleMembers.length ? bond.visibleMembers : (Array.isArray(bond?.members) ? bond.members : []);
  const baseOf = (id) => getChess(id)?.baseId || (typeof id === 'string' ? id.replace(/_b$/, '_a') : id);
  const onBoard = new Set();
  const owned = new Set();
  const inHand = new Set();
  const memberSet = new Set(members);
  /** base id → { on: on the board?, hand: in the hand?, items: the wearer's item ids } — operators of the player that join this bond through 变形同构体 */
  const granted = new Map();
  const grants = (p) => typeof bond?.bondId === 'string' && grantedBonds(p.items, getItem).includes(bond.bondId);
  const itemIds = (p) => p.items.map((it) => (typeof it === 'string' ? it : it?.id)).filter((x) => typeof x === 'string');
  for (const p of Array.isArray(priv?.board) ? priv.board : []) {
    if (p?.kind !== 'chess') continue;
    const base = baseOf(p.id);
    onBoard.add(base); owned.add(base);
    if (!memberSet.has(base) && !granted.has(base) && grants(p)) granted.set(base, { on: true, hand: false, items: itemIds(p) });
  }
  for (const [list, hand] of [[priv?.hand, true], [priv?.temp, false]]) {
    for (const p of Array.isArray(list) ? list : []) {
      if (p?.kind !== 'chess') continue;
      const base = baseOf(p.id);
      owned.add(base);
      if (hand) inHand.add(base);
      if (memberSet.has(base) || !grants(p)) continue;
      const g = granted.get(base);
      if (!g) granted.set(base, { on: false, hand, items: itemIds(p) });
      else if (hand) g.hand = true;
    }
  }
  const rows = members.map((id) => {
    const c = getChess(id);
    return { id, tier: c?.tier ?? 0, name: c?.name ?? id, onBoard: onBoard.has(id), owned: owned.has(id), inHand: inHand.has(id), banned: bannedSet.has(id) };
  });
  for (const [id, g] of granted) {
    const c = getChess(id);
    rows.push({ id, tier: c?.tier ?? 0, name: c?.name ?? id, onBoard: g.on, owned: true, inHand: g.hand, banned: false, granted: true, items: g.items });
  }
  return rows.sort((a, b) => (b.onBoard - a.onBoard) || (b.owned - a.owned) || (a.tier - b.tier) || (a.id < b.id ? -1 : 1));
}

/**
 * The member count of a bond popup's 成员 header: the rows on the board — and, for a bond that counts the hand
 * (`countsHand`: BOARD_AND_DECK — 投资人 远见 奇迹; the server's 在场 says （含整备区）), those in the hand too (the 5
 * temporary slots never count), so the header agrees with 在场 (community report 「投资人等在休整区就能生效的盟约不生效」:
 * the header said 0/n with the members in the hand while 在场 said 3/3).
 * @param {Array<{ onBoard?: boolean, inHand?: boolean }>} rows bondMembers rows @param {boolean} [countsHand]
 * @returns {number}
 */
export function memberHeadCount(rows, countsHand = false) {
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) if (r && (r.onBoard || (countsHand && r.inHand))) n++;
  return n;
}

/**
 * Banned-member count per bond (briefing / info drawer red badge).
 * @param {any[]} bonds bonds.json records
 * @param {string[]} bannedChess
 * @returns {Map<string, number>}
 */
export function bannedPerBond(bonds, bannedChess) {
  const banned = new Set(Array.isArray(bannedChess) ? bannedChess : []);
  const out = new Map();
  for (const b of Array.isArray(bonds) ? bonds : []) {
    if (!isObj(b)) continue;
    const members = Array.isArray(b.visibleMembers) ? b.visibleMembers : [];
    out.set(b.bondId, members.filter((id) => banned.has(id)).length);
  }
  return out;
}

/**
 * The two kinds of greyed bonds of a match (research 01 A2, 06 addendum D):
 *   drawn  — the per-match drawn set D (m.public drawnDisabledBonds): only operators whose EVERY bond is in D leave
 *            the pool, so these bonds stay activatable (multi-bond members, 变形同构体, 调和) — "部分盟约所含干员阵容不完整";
 *   off    — the mode's static inactive list (FUNNY): never activates this match — "本局禁用".
 * Older payloads without drawnDisabledBonds: disabledBonds minus the static list.
 * @param {any} pub m.public
 * @param {string[]} [staticInactive] config.modes[modeId].inactiveBondIds
 * @returns {{ drawn: Set<string>, off: Set<string> }}
 */
export function disabledBondSets(pub, staticInactive = []) {
  const off = new Set(Array.isArray(staticInactive) ? staticInactive : []);
  const src = Array.isArray(pub?.drawnDisabledBonds) ? pub.drawnDisabledBonds : Array.isArray(pub?.disabledBonds) ? pub.disabledBonds : [];
  const drawn = new Set(src.filter((b) => typeof b === 'string' && !off.has(b)));
  return { drawn, off };
}

/**
 * Briefing tooltip of a bond disc.
 * @param {string} name
 * @param {'off'|'drawn'|null} state from disabledBondSets
 * @param {number} bannedN banned operators of the bond
 */
export function briefingBondTip(name, state, bannedN = 0) {
  if (state === 'off') return `${name}：本局禁用（该盟约不会激活）`;
  if (state === 'drawn' || bannedN > 0) return `${name}：部分盟约所含干员阵容不完整${bannedN ? `（${bannedN} 名干员无法出现）` : ''}`;
  return name;
}

/**
 * The bonds a mode never activates (config.json modes[modeId].inactiveBondIds = the official modeDataDict
 * inactiveBondIdList: 标准模拟 leaves 拉特兰 阿戈尔 卡西米尔 灵巧 奥术 奇迹 投资人 突袭 独行 绝技 off). Operators that also carry an
 * enabled bond stay in the pool (server pool.js drawDisabledBonds) — 标准's 深靛 洛洛 阿罗玛 夕 圣聆初雪 still show 奥术 — and
 * the server left such a bond out of m.private.bonds, so without a mark a card read "奥术 0/2 未激活" with three 奥术
 * operators deployed (player report after 0.1.0: "奥术盟约不生效"). The shop / reward cards, the detail card's bond chips
 * and the bond popup mark these 本局禁用 (briefingBondTip 'off'); since 0.1.3 the server also lists such a bond the player
 * has members of (`off: true`, server/match/bondsMeta.js offBondCounts) and the strip shows it as a grey 本局禁用 disc.
 * @param {any} mode config.json modes[modeId] (data.js getMode), or null
 * @returns {Set<string>}
 */
export function modeOffBonds(mode) {
  const list = isObj(mode) && Array.isArray(mode.inactiveBondIds) ? mode.inactiveBondIds : [];
  return new Set(list.filter((b) => typeof b === 'string'));
}

/**
 * The bonds a strategy is built around that this mode switches off: bands.json `bondIds` (shared/bandBonds.js at build
 * time — the field the server's bot reads too, GameData.bandBondIds) ∩ `off` (modeOffBonds). 标准: 潘格尼尼 → 拉特兰,
 * 克莱门莎 → 阿戈尔, 玛恩纳 → 卡西米尔; the strategy draft marks such a band 本局禁用 (still selectable, DESIGN §21.26).
 * @param {any} band bands.json record @param {Set<string>|null} off
 * @returns {string[]}
 */
export function bandOffBonds(band, off) {
  if (!(off instanceof Set) || !off.size || !Array.isArray(band?.bondIds)) return [];
  return band.bondIds.filter((b) => typeof b === 'string' && off.has(b));
}

/**
 * The strategy draft's note for such a band: "本局禁用【拉特兰】盟约，此策略效果可能无法发挥".
 * @param {string[]} names the switched-off bonds' names
 */
export function bandOffLine(names) {
  const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n);
  return list.length ? `本局禁用${list.map((n) => `【${n}】`).join('')}盟约，此策略效果可能无法发挥` : '';
}

// ---- shop ---------------------------------------------------------------------------------------------

/**
 * Price tone of a shop slot: discounted (mint), marked up (red) or normal (gold).
 * @param {{price?:number, basePrice?:number}|null} slot
 * @returns {'discount'|'premium'|'gold'}
 */
export function priceTone(slot) {
  if (!isObj(slot)) return 'gold';
  const p = Number(slot.price);
  const b = Number(slot.basePrice);
  if (Number.isFinite(p) && p === 0) return 'discount';
  if (!Number.isFinite(p) || !Number.isFinite(b)) return 'gold';
  if (p < b) return 'discount';
  if (p > b) return 'premium';
  return 'gold';
}

/**
 * Owned copies of a base chess (normal pieces on board/hand/temp) — shop cards show merge progress. An elite card
 * never merges (server PlayerState.completesChessMerge refuses isGolden), so it reports 0 copies: no pips, no 可晋升
 * tag and no mergeTarget tile.
 * @param {any} priv
 * @param {string} chessId
 * @param {(id:string)=>any} [getChess]
 * @returns {{ copies: number, need: number }}
 */
export function mergeProgress(priv, chessId, getChess = () => null) {
  const c = getChess(chessId);
  const base = c?.baseId || chessId;
  const need = Number.isInteger(c?.upgradeNum) && c.upgradeNum > 0 ? c.upgradeNum : 3;
  if (c?.isGolden) return { copies: 0, need };
  let copies = 0;
  const pieces = [...(Array.isArray(priv?.board) ? priv.board : []), ...(Array.isArray(priv?.hand) ? priv.hand : []), ...(Array.isArray(priv?.temp) ? priv.temp : [])];
  for (const p of pieces) if (p?.kind === 'chess' && !p.golden && (p.id === base || getChess(p.id)?.baseId === base) && !String(p.id).endsWith('_b')) copies += 1;
  return { copies, need };
}

/**
 * Where the elite appears when gaining one more normal copy of `chessId` completes a merge now (PRTS 卫戍协议/帮助
 * "若消耗已部署至作战区的干员，则发送至作战区对应位置"; mirror of server board.js mergeTile / PlayerState._mergeChess): the
 * board tile of the deployed copy that deploys first (col asc, then row desc: by column from the left, top to bottom —
 * Battle.start) — `{ row, col, dir }` — or null (no
 * merge — an elite card never merges, see mergeProgress — or no copy is deployed: the elite goes to the hand). The
 * copies stand on legal tiles, and the elite is the same operator, so the tile needs no legality check here.
 * @param {any} priv
 * @param {string} chessId
 * @param {(id:string)=>any} [getChess]
 * @returns {{ row: number, col: number, dir: string } | null}
 */
export function mergeTarget(priv, chessId, getChess = () => null) {
  const { copies, need } = mergeProgress(priv, chessId, getChess);
  if (!(copies > 0 && copies + 1 >= need)) return null;
  const c = getChess(chessId);
  const base = c?.baseId || chessId;
  const board = (Array.isArray(priv?.board) ? priv.board : []).filter((p) => p?.kind === 'chess' && !p.golden && Number.isInteger(p.row) && Number.isInteger(p.col)
    && !String(p.id).endsWith('_b') && (p.id === base || getChess(p.id)?.baseId === base));
  if (!board.length) return null;
  board.sort((a, b) => a.col - b.col || b.row - a.row);
  return { row: board[0].row, col: board[0].col, dir: board[0].dir || 'RIGHT' };
}

/** Whether every hand slot is taken (the server refuses a purchase / reward that needs a slot: HAND_FULL). */
export function handFull(priv) {
  const hand = Array.isArray(priv?.hand) ? priv.hand : [];
  return hand.length >= GEO.HAND_SIZE && hand.every((p) => p != null);
}

/**
 * Would gaining one more `slot` (shop / reward card: { kind: 'chess'|'item', id }) complete a merge right away, so it
 * needs no hand slot? Mirror of server PlayerState completesChessMerge / completesItemMerge.
 * @param {any} priv
 * @param {{kind?:string, id:string}} slot
 * @param {{ getChess?:(id:string)=>any, getItem?:(id:string)=>any, itemMergeCount?: number }} [o]
 */
export function completesMerge(priv, slot, { getChess = () => null, getItem = () => null, itemMergeCount = 2 } = {}) {
  if (!isObj(slot) || typeof slot.id !== 'string') return false;
  if (slot.kind === 'item') {
    const rec = getItem(slot.id);
    if (!rec || rec.isGolden || rec.itemType !== 'EQUIP' || !rec.mergeable) return false;
    const n = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : itemMergeCount;
    if (!(n > 1 && n < 100) || !getItem(rec.upgradeChessId || rec.goldenId)) return false;
    let have = 0;
    const holders = [...(Array.isArray(priv?.board) ? priv.board : []), ...(Array.isArray(priv?.hand) ? priv.hand : []), ...(Array.isArray(priv?.temp) ? priv.temp : [])];
    for (const p of holders) {
      if (!isObj(p)) continue;
      if (p.kind === 'item' && p.id === slot.id) have += 1;
      if (p.kind === 'chess') for (const it of Array.isArray(p.items) ? p.items : []) if (it?.id === slot.id) have += 1;
    }
    return have + 1 >= n;
  }
  const rec = getChess(slot.id);
  if (!rec || rec.isGolden) return false;
  const base = getChess(rec.baseId) || rec;
  const golden = (base.goldenId && getChess(base.goldenId)) || getChess(String(base.chessId || slot.id).replace(/_a$/, '_b'));
  if (!golden) return false;
  const { copies, need } = mergeProgress(priv, slot.id, getChess);
  return need > 1 && copies + 1 >= need;
}

/**
 * How the shop bar names a free pick-one offer (m.private shop.rewardOffer): the promotion reward (`source` 'merge')
 * reads 晋升奖励 / PROMOTION; any other offer — a strategy's special refresh (凯瑟琳 定向投放, 娜仁图亚 见者有份), an item
 * (寻呼模块, 信标) or a 特质 (松果) — reads its `label` with the refresh icon (player report #6 after 0.1.0: 凯瑟琳's three
 * items showed up as nameless operator cards under 晋升奖励). `items` = the offer holds items (cards drawn as item cards).
 * `queued` = offers waiting behind this one (shop.rewardOffer.queued, e.g. a 定向投放 behind a promotion reward put
 * off): `more` (header) and the pill's "+N" say so, null / no suffix when none.
 * @param {any} offer
 * @returns {{ title: string, micro: string, sub: string, icon: string, items: boolean, pill: string, queued: number, more: string|null }}
 */
export function offerHeader(offer) {
  const slots = isObj(offer) && Array.isArray(offer.slots) ? offer.slots : [];
  const items = slots.some((s) => isObj(s) && s.kind === 'item');
  const label = isObj(offer) && typeof offer.label === 'string' && offer.label ? offer.label : null;
  const queued = isObj(offer) && Number.isInteger(offer.queued) && offer.queued > 0 ? offer.queued : 0;
  const tail = { queued, more: queued ? `之后还有 ${queued} 项` : null };
  if (!items && (!isObj(offer) || offer.source === 'merge' || offer.source == null) && !label) {
    return { title: '晋升奖励', micro: 'PROMOTION', sub: '免费选择 1 名', icon: 'crown', items: false, pill: '晋升奖励待选择', ...tail };
  }
  const title = label || (items ? '装备补给' : '特殊招募');
  return { title, micro: 'SPECIAL', sub: items ? '免费选择 1 件' : '免费选择 1 名', icon: 'refresh', items, pill: `${title}待选择`, ...tail };
}

/**
 * Why a shop action is unavailable (null when available).
 * @param {'buy'|'reward'|'refresh'|'freeze'|'levelUp'|'ready'} kind
 * @param {{ priv:any, editable:boolean, slot?:any, getChess?:(id:string)=>any, getItem?:(id:string)=>any }} ctx
 * @returns {string|null} Chinese reason
 */
export function shopBlockReason(kind, { priv, editable, slot, getChess, getItem } = {}) {
  if (!priv) return '尚未就绪';
  if (priv.alive === false) return '你已被淘汰';
  if (kind === 'ready') return priv.canReady === false ? '临时整备区不为空，请先处理溢出的资源' : null;
  if (!editable) {
    if (kind === 'reward') return '当前无法选择';
    return priv.ready ? '已准备就绪，取消准备后才能操作' : '当前阶段无法进行该操作';
  }
  const funds = Number(priv.funds) || 0;
  const shop = priv.shop || {};
  if (kind === 'buy' || kind === 'reward') {
    if (!isObj(slot) || slot.sold) return kind === 'reward' ? '已选择' : '已售出';
    if ((Number(slot.price) || 0) > funds) return '资金不足';
    if (handFull(priv) && !completesMerge(priv, slot, { getChess, getItem })) return '整备区已满';
    return null;
  }
  if (kind === 'refresh') return (Number(shop.refreshPrice) || 0) > funds ? '资金不足' : null;
  if (kind === 'levelUp') {
    if ((Number(shop.level) || 1) >= (Number(shop.maxLevel) || 6)) return '调度中心已达最高等级';
    return (Number(shop.upgradePrice) || 0) > funds ? '资金不足' : null;
  }
  return null;
}

/**
 * The 准备 confirmation (community report #4 after 0.1.2): readying with funds left asks first — the prep's end wipes
 * them (PRTS 卫戍协议/帮助 「本回合的剩余资金将清零」; the server still does: PlayerState.endPrep). act2autochess constData
 * `noMoneyTipsBand` — data/config.json economy.leftoverFundsKeptByBands, ["band_cannot"] — names the strategies whose
 * funds carry over and that get no such tip (坎诺特 利滚利). No prompt for an un-ready, with 0 funds, when already ready
 * or out, or under AI 托管 (the server plays the seat). The dialog's wording is the remake's own [ASSUMED]: neither the
 * tables nor PRTS hold the official one.
 * @param {any} priv m.private
 * @param {{ ready?: boolean, keptBands?: string[]|null, autoplay?: boolean }} [opts] `ready`: the state asked for
 * @returns {{ title: string, text: string, okText: string, cancelText: string, micro: string } | null}
 */
export function readyFundsPrompt(priv, { ready = true, keptBands = null, autoplay = false } = {}) {
  if (!ready || autoplay || !isObj(priv) || priv.alive === false || priv.ready) return null;
  const funds = Math.trunc(Number(priv.funds) || 0);
  if (!(funds > 0)) return null;
  const kept = Array.isArray(keptBands) ? keptBands : ['band_cannot'];
  if (typeof priv.bandId === 'string' && kept.includes(priv.bandId)) return null;
  return {
    title: '剩余资金', micro: 'FUNDS LEFT', okText: '准备就绪', cancelText: '继续整备',
    text: `还有 ${funds} 资金未使用。休整期结束时，本回合的剩余资金将清零。确定准备就绪吗？`,
  };
}

// ---- placement (canPlace mirror) ------------------------------------------------------------------------

/**
 * Deployable tiles of the own board for a stage record, in board coordinates: the normal field (default), or — `field`
 * 'bossL' / 'bossR' — the player's half of the boss field (always derived from the legend + active devices, like the
 * server's deploy map on that field).
 * @param {any} stage stages.json record
 * @param {'normal'|'bossL'|'bossR'} [field]
 * @param {{ deviceOverrides?: Record<string, boolean>, tileOverrides?: Record<string, string> }} [overrides] boss field
 *   only (the normal field takes them folded into the stage: `effectiveStage`)
 * @returns {{ melee: Set<string>, ranged: Set<string> }} ranged = melee ∪ rangedOnly
 */
export function deploySets(stage, field = 'normal', overrides = {}) {
  const melee = new Set();
  const ranged = new Set();
  if (field === 'bossL' || field === 'bossR') {
    for (const [k, cls] of deployMap(stage, { ...(isObj(overrides) ? overrides : {}), field })) { ranged.add(k); if (cls === 'melee') melee.add(k); }
    return { melee, ranged };
  }
  const inField = (r, c) => r >= GEO.FIELD.r0 && r <= GEO.FIELD.r1 && c >= GEO.FIELD.c0 && c <= GEO.FIELD.c1;
  const dt = stage?.deployTiles?.normal;
  if (isObj(dt) && Array.isArray(dt.melee)) {
    for (const t of dt.melee) if (Array.isArray(t) && inField(t[0], t[1])) { melee.add(tileKey(t[0], t[1])); ranged.add(tileKey(t[0], t[1])); }
    for (const t of Array.isArray(dt.rangedOnly) ? dt.rangedOnly : []) if (Array.isArray(t) && inField(t[0], t[1])) ranged.add(tileKey(t[0], t[1]));
    return { melee, ranged };
  }
  // derive from the tile legend
  const rows = Array.isArray(stage?.rows) ? stage.rows : [];
  const tiles = isObj(stage?.tiles) ? stage.tiles : {};
  for (let r = GEO.FIELD.r0; r <= GEO.FIELD.r1; r++) {
    const line = typeof rows[r] === 'string' ? rows[r] : '';
    for (let c = GEO.FIELD.c0; c <= GEO.FIELD.c1; c++) {
      const t = tiles[line[c]];
      if (!isObj(t)) continue;
      const k = tileKey(r, c);
      if (t.height === 'LOW' && (t.buildable === 'ALL' || t.buildable === 'MELEE')) { melee.add(k); ranged.add(k); }
      else if (t.buildable === 'ALL' || t.buildable === 'RANGED') ranged.add(k);
    }
  }
  return { melee, ranged };
}

// ---- per-player stage overrides (terrain 机变 cards) ------------------------------------------------------

const OBSTACLE_ROLES = new Set(['crate', 'mound']);
const PLATFORM_ROLES = new Set(['platform']);
/** 特制水上平台 (act1 m05, weight 0 this season): its 深水区 tile takes any unit ("在水上建立可以部署任意单位的平台"). */
const WATER_PLATFORM_ROLES = new Set(['waterPlatform']);
const hasKeys = (o) => isObj(o) && Object.keys(o).length > 0;

/**
 * The own board's device / tile overrides the server applies to placement (server/match/board.js buildDeployMap
 * `deviceOverrides` / `tileOverrides`, set by 模拟战场演变 cards). m.private may carry them directly
 * (`deviceOverrides` / `tileOverrides`); otherwise they are derived from the owned 机变 effect entries
 * (`choice:<effectId>#<n>` / `<effectId>#<n>`) whose data/effects.json record has `auto_chess_change_map`
 * buffs — the blackboard's `trap_…#nnn` aliases, applied in pick order like the server does.
 * @param {any} priv m.private
 * @param {(id:string)=>any} [getEffect] effects.json lookup
 * @returns {{ deviceOverrides: Record<string, boolean>, tileOverrides: Record<string, string> }}
 */
export function stageOverrides(priv, getEffect = () => null) {
  const deviceOverrides = {};
  const tileOverrides = {};
  if (isObj(priv?.deviceOverrides) || isObj(priv?.tileOverrides)) {
    for (const [k, v] of Object.entries(isObj(priv.deviceOverrides) ? priv.deviceOverrides : {})) deviceOverrides[k] = !!v;
    for (const [k, v] of Object.entries(isObj(priv.tileOverrides) ? priv.tileOverrides : {})) if (typeof v === 'string') tileOverrides[k] = v;
    return { deviceOverrides, tileOverrides };
  }
  for (const e of Array.isArray(priv?.effects) ? priv.effects : []) {
    // picked 机变 cards: 'choice:<effectId>#<n>' (sim/content/choices.js refIdFor) or '<effectId>#<n>' (choices.js
    // addRef); band / builtin entries (no '#<n>', other prefixes) are not picks
    const m = typeof e?.id === 'string' ? /^(?:choice:)?([^:#]+)#\d+$/.exec(e.id) : null;
    if (!m) continue;
    const eff = getEffect(m[1]);
    for (const b of Array.isArray(eff?.buffs) ? eff.buffs : []) {
      if (b?.key !== 'auto_chess_change_map' || !isObj(b.bb)) continue;
      for (const [alias, v] of Object.entries(b.bb)) if (alias.includes('#')) deviceOverrides[alias] = Number(v) !== 0;
    }
  }
  return { deviceOverrides, tileOverrides };
}

/**
 * Deploy classes of the own board — mirror of server/match/board.js buildDeployMap (legend + active devices +
 * overrides, on deploy field `field`): 'melee' (melee and ranged) or 'ranged' (ranged only) per board 'r,c'.
 * @param {any} stage
 * @param {{ deviceOverrides?: Record<string, boolean>, tileOverrides?: Record<string, string>, field?: 'normal'|'bossL'|'bossR' }} [o]
 * @returns {Map<string, 'melee'|'ranged'>}
 */
export function deployMap(stage, { deviceOverrides = {}, tileOverrides = {}, field = 'normal' } = {}) {
  const F = GEO.FIELD;
  const inField = (r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= F.r0 && r <= F.r1 && c >= F.c0 && c <= F.c1;
  const map = new Map();
  const rows = Array.isArray(stage?.rows) ? stage.rows : null;
  const legend = isObj(stage?.tiles) ? stage.tiles : {};
  for (let r = F.r0; r <= F.r1; r++) {
    for (let c = F.c0; c <= F.c1; c++) {
      const [sr, sc] = fieldTile(field, r, c);
      const line = rows && typeof rows[sr] === 'string' ? rows[sr] : null;
      let cls = null;
      if (line) {
        const g = line[sc];
        const t = g != null && Object.hasOwn(legend, g) ? legend[g] : null;
        if (t) {
          const b = t.buildable;
          if (t.height === 'LOW' && (b === 'ALL' || b === 'MELEE')) cls = 'melee';
          else if ((t.height === 'HIGH' && (b === 'ALL' || b === 'RANGED')) || (t.height === 'LOW' && b === 'RANGED')) cls = 'ranged';
        }
      } else if (!stage) cls = c === 9 ? null : 'melee';
      if (cls) map.set(tileKey(r, c), cls);
    }
  }
  for (const d of Array.isArray(stage?.devices) ? stage.devices : []) {
    if (!isObj(d) || !Array.isArray(d.pos)) continue;
    const [r, c] = boardTileOf(field, d.pos[0], d.pos[1]);
    if (!inField(r, c)) continue;
    let active;
    if (d.alias != null && isObj(deviceOverrides) && Object.hasOwn(deviceOverrides, d.alias)) active = !!deviceOverrides[d.alias];
    else if (typeof d.active === 'boolean') active = d.active;
    else active = !d.hidden;
    if (!active) continue;
    if (OBSTACLE_ROLES.has(d.role)) map.delete(tileKey(r, c));
    else if (PLATFORM_ROLES.has(d.role)) map.set(tileKey(r, c), 'ranged');
    else if (WATER_PLATFORM_ROLES.has(d.role)) map.set(tileKey(r, c), 'melee');
  }
  for (const [k, v] of Object.entries(isObj(tileOverrides) ? tileOverrides : {})) {
    const [r, c] = String(k).split(',').map(Number);
    if (!inField(r, c)) continue;
    if (v === 'melee' || v === 'ranged') map.set(tileKey(r, c), v);
    else if (v === 'none') map.delete(tileKey(r, c));
  }
  return map;
}

/**
 * The stage as this player's board looks with its overrides: devices switched by `deviceOverrides` carry the new
 * `active` flag (the renderer draws / hides crates and platforms from it) and `deployTiles.normal` is rebuilt
 * from the deploy map. Returns the stage itself when nothing is overridden.
 * @param {any} stage stages.json record
 * @param {{ deviceOverrides?: Record<string, boolean>, tileOverrides?: Record<string, string> }} [overrides]
 */
export function effectiveStage(stage, overrides = {}) {
  const dev = isObj(overrides?.deviceOverrides) ? overrides.deviceOverrides : {};
  const tiles = isObj(overrides?.tileOverrides) ? overrides.tileOverrides : {};
  if (!isObj(stage) || (!hasKeys(dev) && !hasKeys(tiles))) return stage;
  const devices = (Array.isArray(stage.devices) ? stage.devices : []).map((d) => (
    isObj(d) && d.alias != null && Object.hasOwn(dev, d.alias) ? { ...d, active: !!dev[d.alias] } : d));
  const map = deployMap(stage, { deviceOverrides: dev, tileOverrides: tiles });
  const melee = [];
  const rangedOnly = [];
  for (const [k, cls] of map) {
    const [r, c] = k.split(',').map(Number);
    (cls === 'melee' ? melee : rangedOnly).push([r, c]);
  }
  const deployTiles = { ...(isObj(stage.deployTiles) ? stage.deployTiles : {}), normal: { melee, rangedOnly } };
  return { ...stage, devices, deployTiles };
}

/**
 * Index every own piece by uid.
 * @param {any} priv m.private
 * @returns {Map<number, { piece:any, area:'board'|'hand'|'temp', row?:number, col?:number, idx?:number }>}
 */
export function indexPieces(priv) {
  const map = new Map();
  (Array.isArray(priv?.board) ? priv.board : []).forEach((p) => {
    if (isObj(p) && Number.isInteger(p.uid)) map.set(p.uid, { piece: p, area: 'board', row: p.row, col: p.col });
  });
  (Array.isArray(priv?.hand) ? priv.hand : []).forEach((p, idx) => {
    if (isObj(p) && Number.isInteger(p.uid)) map.set(p.uid, { piece: p, area: 'hand', idx });
  });
  (Array.isArray(priv?.temp) ? priv.temp : []).forEach((p, idx) => {
    if (isObj(p) && Number.isInteger(p.uid)) map.set(p.uid, { piece: p, area: 'temp', idx });
  });
  return map;
}

/**
 * Build the placement context for `canPlace`. The deploy tiles include the player's stage overrides (terrain 机变
 * cards, `stageOverrides`), like the server's per-player deploy map, on the field the pieces are deployed on
 * (`field` = `deployFieldOf(pub, myId)`: the own board, or the player's half of the boss field in a boss round).
 * @param {{ priv:any, stage:any, editable:boolean, field?:'normal'|'bossL'|'bossR', getChess?:(id:string)=>any,
 *   getToken?:(id:string)=>any, getItem?:(id:string)=>any, getEffect?:(id:string)=>any }} o
 */
export function placementContext({ priv, stage, editable, field = 'normal', getChess = () => null, getToken = () => null, getItem = () => null, getEffect = () => null }) {
  const pieces = indexPieces(priv);
  const boardAt = new Map();
  for (const e of pieces.values()) if (e.area === 'board') boardAt.set(tileKey(e.row, e.col), e);
  const handAt = new Map();
  for (const e of pieces.values()) if (e.area === 'hand') handAt.set(e.idx, e);
  const cap = Number.isInteger(priv?.deployCap) ? priv.deployCap : 8;
  let deployed = 0;
  for (const e of pieces.values()) if (e.area === 'board' && e.piece.kind === 'chess') deployed += 1;
  const count = Number.isInteger(priv?.deployCount) ? priv.deployCount : deployed;
  const ov = stageOverrides(priv, getEffect);
  // the own normal board keeps the data's deploy tiles (with the terrain overrides folded in); the boss field of a
  // boss round's prep is read from the legend + its devices under the same overrides (server deploy map, field)
  const deploy = field === 'bossL' || field === 'bossR'
    ? deploySets(stage, field, ov)
    : deploySets(effectiveStage(stage, ov));
  return { priv, pieces, boardAt, handAt, deploy, cap, count, field, editable: !!editable, getChess, getToken, getItem };
}

/**
 * Deploy position ('MELEE'|'RANGED'|'ALL') of a chess/token piece, or null for items. Elite 歌蕾蒂娅 carrying HOK-Y
 * (the viewer's loadout, shared/highGround.js) is 'ALL': any deployable tile, the 高台 included
 * (server/match/board.js placeClass; owner's decision 2026-10-04). Every other MELEE chess is ground-only.
 */
export function piecePosition(ctx, piece) {
  if (!isObj(piece)) return null;
  if (piece.kind === 'chess') {
    const rec = ctx.getChess(piece.id);
    let moduleId = null;
    try { moduleId = resolveLoadout(ctx.priv?.loadout ?? null, rec, ctx.getChess)?.moduleId ?? null; } catch { moduleId = null; }
    if (meleeOnHighGround(rec, moduleId)) return 'ALL';
    return rec?.position === 'MELEE' ? 'MELEE' : 'RANGED';
  }
  // tokens: MELEE → ground only; RANGED / ALL → any deployable tile
  if (piece.kind === 'token') return ctx.getToken(piece.id)?.position === 'MELEE' ? 'MELEE' : 'RANGED';
  return null;
}

/** Whether a unit piece (chess/token) may stand on a board tile. */
export function tileAllows(ctx, piece, row, col) {
  const pos = piecePosition(ctx, piece);
  if (!pos) return false;
  const k = tileKey(row, col);
  return pos === 'MELEE' ? ctx.deploy.melee.has(k) : ctx.deploy.ranged.has(k);
}

/**
 * Board tiles ('r,c') where a summon whose text reads "只能部署在召唤者攻击范围内" may stand (tokens.json `ownerRange`:
 * 伺夜's 狼群, 缪尔赛思's 流形 — the tactical point; player report #9 after 0.1.0): its owner's attack range (the
 * loadout's grid, shared/loadoutRecord.js attackRangeGrid, rotated by the owner's facing around its tile). Null when
 * the piece is not range-bound or its owner is not on the board. `owner` ({ row, col, piece }) replaces the owner's
 * current position (a summon swapped with its own owner). Mirror of server/match/PlayerState.js summonRange.
 * @param {ReturnType<typeof placementContext>} ctx
 * @returns {Set<string> | null}
 */
export function summonRange(ctx, piece, owner = null) {
  if (!isObj(piece) || piece.kind !== 'token' || ctx?.getToken?.(piece.id)?.ownerRange !== true) return null;
  let at = owner;
  if (!at) for (const e of ctx.boardAt.values()) if (e.piece.uid === piece.ownerUid && e.piece.kind === 'chess') { at = e; break; }
  const rec = at && ctx.getChess(at.piece.id);
  if (!rec) return null;
  let grid = null;
  try { grid = attackRangeGrid(chessLoadout(rec, ctx.priv?.loadout ?? null, ctx.getChess)?.record || rec); } catch { /* the data grid */ }
  return new Set(rangeTiles(grid || rec.rangeGrid, at.row, at.col, pieceDir(at.piece)).map(([r, c]) => tileKey(r, c)));
}

/** tileAllows plus the owner-range rule of a range-bound summon (summonRange). */
function unitAllowed(ctx, piece, row, col, owner = null) {
  if (!tileAllows(ctx, piece, row, col)) return false;
  const range = summonRange(ctx, piece, owner);
  return !range || range.has(tileKey(row, col));
}

/**
 * Placement legality of dropping piece `uid` on `target` (mirror of server/match/PlayerState.js move / equip /
 * useArt and server/match/board.js canPlace):
 *   board ← chess: legal tile for its position; empty tile or a chess occupant (swap; from the board the occupant
 *     must be legal on the source tile); from hand/temp the deploy cap applies unless a chess occupant swaps out.
 *   board ← token: legal tile; from the hand the tile must be empty and its summoner deployed; board ↔ board swaps.
 *   hand ← chess from the board: empty slot (withdraw), chess occupant (swap, legal on the source tile), otherwise
 *     it goes to any free slot (HAND_FULL when none). hand ← token from the board: always (back onto its stack).
 *   hand ← hand/temp piece: move / swap. hand ← EQUIP item onto a chess: equip; onto a non-chess: swap.
 *   board ← EQUIP item: equip the chess on that tile. board ← MAGIC (Arts): used on that tile.
 * @param {ReturnType<typeof placementContext>} ctx
 * @param {number} uid
 * @param {{area:'board',row:number,col:number}|{area:'hand',idx:number}|{area:'outside'}} target
 * @returns {{ ok: boolean, action?: 'move'|'swap'|'orient'|'equip'|'art', reason?: string, code?: string }}
 */
export function canPlace(ctx, uid, target) {
  const no = (code, reason) => ({ ok: false, code, reason });
  if (!ctx || !ctx.editable) return no('WRONG_PHASE', '当前阶段无法进行该操作');
  const src = ctx.pieces.get(uid);
  if (!src) return no('BAD_TARGET', '找不到该单位');
  if (!isObj(target)) return no('BAD_TILE', '无法部署在该位置');
  const piece = src.piece;
  const isMagic = piece.kind === 'item' && ctx.getItem(piece.id)?.itemType === 'MAGIC';

  if (target.area === 'hand') {
    const idx = target.idx;
    if (!Number.isInteger(idx) || idx < 0 || idx >= GEO.HAND_SIZE) return no('BAD_TILE', '无法放置在该位置');
    if (src.area === 'hand' && src.idx === idx) return no('ALREADY', '位置未变化');
    const occ = ctx.handAt.get(idx);
    if (!occ) return { ok: true, action: 'move' };
    if (piece.kind === 'item') {
      if (occ.piece.kind === 'chess') return isMagic ? no('BAD_TARGET', '该道具需要放置在战场上使用') : equipCheck(ctx, piece, occ.piece);
      return { ok: true, action: 'swap' };
    }
    if (src.area === 'board') {
      if (piece.kind === 'token') return { ok: true, action: 'move' }; // back onto its stack
      if (occ.piece.kind === 'chess') {
        if (!tileAllows(ctx, occ.piece, src.row, src.col)) return no('BAD_TILE', '交换后的单位无法部署在原位置');
        return { ok: true, action: 'swap' };
      }
      // the withdrawn operator goes to another free slot
      const free = [...Array(GEO.HAND_SIZE).keys()].some((i) => !ctx.handAt.has(i));
      return free ? { ok: true, action: 'move' } : no('HAND_FULL', '整备区已满');
    }
    return { ok: true, action: 'swap' };
  }

  if (target.area === 'board') {
    const { row, col } = target;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return no('BAD_TILE', '无法部署在该位置');
    const inField = row >= GEO.FIELD.r0 && row <= GEO.FIELD.r1 && col >= GEO.FIELD.c0 && col <= GEO.FIELD.c1;
    if (!inField) return no('BAD_TILE', '无法部署在该位置');
    const occ = ctx.boardAt.get(tileKey(row, col));
    if (piece.kind === 'item') {
      if (isMagic) return { ok: true, action: 'art' };
      if (!occ) return no('BAD_TARGET', '请将装备拖拽至干员身上');
      return equipCheck(ctx, piece, occ.piece);
    }
    // its own tile: re-orient in place through the direction wheel (research 09 §1.2)
    if (src.area === 'board' && src.row === row && src.col === col) return { ok: true, action: 'orient' };
    if (!tileAllows(ctx, piece, row, col)) {
      const deployable = ctx.deploy.ranged.has(tileKey(row, col));
      return no('BAD_TILE', deployable && piecePosition(ctx, piece) === 'MELEE' ? '近战单位只能部署在地面' : '无法部署在该位置');
    }
    // a range-bound summon (战术点): inside its owner's attack range — seen from the summon's old tile when it is
    // dropped onto its own owner (the two swap)
    const ownerSwap = src.area === 'board' && occ && occ.piece.uid === piece.ownerUid ? { row: src.row, col: src.col, piece: occ.piece } : null;
    const range = summonRange(ctx, piece, ownerSwap);
    if (range && !range.has(tileKey(row, col))) return no('BAD_TILE', '只能部署在召唤者攻击范围内');
    if (src.area === 'board') {
      // board → board: move or swap (the occupant must be legal on the source tile — the mover's own summon excepted:
      // a moved operator's summons go back to the hand anyway)
      const ownSummon = occ && occ.piece.kind === 'token' && occ.piece.ownerUid === piece.uid;
      if (occ && !ownSummon && !unitAllowed(ctx, occ.piece, src.row, src.col)) return no('BAD_TILE', '交换后的单位无法部署在原位置');
      return { ok: true, action: occ ? 'swap' : 'move' };
    }
    if (piece.kind === 'token') {
      if (occ) return no('BAD_TILE', '该位置已有单位');
      const ownerDeployed = [...ctx.boardAt.values()].some((e) => e.piece.uid === piece.ownerUid);
      if (Number.isInteger(piece.ownerUid) && !ownerDeployed) return no('BAD_TARGET', '召唤者尚未部署');
      return { ok: true, action: 'move' };
    }
    if ((!occ || occ.piece.kind !== 'chess') && ctx.count >= ctx.cap) return no('BOARD_FULL', '已达到部署上限');
    return { ok: true, action: occ ? 'swap' : 'move' };
  }
  return no('BAD_TILE', '无法放置在该位置');
}

function equipCheck(ctx, itemPiece, targetPiece) {
  const item = ctx.getItem(itemPiece.id);
  if (item?.itemType === 'MAGIC') return { ok: false, code: 'BAD_TARGET', reason: '该道具需要放置在战场上使用' };
  if (!isObj(targetPiece) || targetPiece.kind !== 'chess') return { ok: false, code: 'BAD_TARGET', reason: '装备只能配发给干员' };
  return { ok: true, action: 'equip' };
}

/** Whether equipping `itemId` attaches it (true) or consumes it on equip (false: no slot is used / replaced). */
export function itemAttaches(item) {
  return !(typeof item?.kind === 'string' && item.kind.startsWith('consume_on_equip'));
}

/**
 * Whether equipping item `uid` completes an item merge (an identical normal copy is owned elsewhere — hand, temp or
 * equipped): the server then merges the pair into the golden item instead of equipping (server PlayerState.equip →
 * completesItemMerge), so a full carrier loses nothing and no replace dialog is needed.
 * @param {ReturnType<typeof placementContext>} ctx
 * @param {number} uid
 * @param {number} [itemMergeCount] default copies per merge (config)
 */
export function equipMerges(ctx, uid, itemMergeCount = 2) {
  const piece = ctx?.pieces?.get(uid)?.piece;
  if (!isObj(piece) || piece.kind !== 'item') return false;
  const rec = ctx.getItem?.(piece.id);
  if (!rec || rec.isGolden || rec.itemType !== 'EQUIP' || !rec.mergeable) return false;
  const n = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : itemMergeCount;
  if (!(n > 1 && n < 100) || !ctx.getItem(rec.upgradeChessId || rec.goldenId)) return false;
  let have = 0;
  for (const e of ctx.pieces.values()) {
    const p = e.piece;
    if (p.uid !== uid && p.kind === 'item' && p.id === piece.id) have += 1;
    if (p.kind === 'chess') for (const it of Array.isArray(p.items) ? p.items : []) if (it?.id === piece.id && it.uid !== uid) have += 1;
  }
  return have + 1 >= n;
}

/**
 * All legal board tiles for dragging `uid` (for view.highlightTiles).
 * @param {ReturnType<typeof placementContext>} ctx
 * @param {number} uid
 * @returns {{ legal: Array<[number, number]>, illegal: Array<[number, number]> }}
 */
export function boardTargets(ctx, uid) {
  const legal = [];
  const illegal = [];
  if (!ctx?.pieces?.get(uid)) return { legal, illegal };
  for (let r = GEO.FIELD.r0; r <= GEO.FIELD.r1; r++) {
    for (let c = GEO.FIELD.c0; c <= GEO.FIELD.c1; c++) {
      const k = tileKey(r, c);
      if (!ctx.deploy.ranged.has(k) && !ctx.boardAt.has(k)) continue; // never-deployable scenery
      (canPlace(ctx, uid, { area: 'board', row: r, col: c }).ok ? legal : illegal).push([r, c]);
    }
  }
  return { legal, illegal };
}

/**
 * The `g.*` intent for a drop, or null (no-op / illegal / UI-handled).
 * @param {ReturnType<typeof placementContext>} ctx
 * @param {number} uid
 * @param {any} target
 * @returns {{ t: string, fields: object, confirmReplace?: boolean } | null}
 */
export function dropIntent(ctx, uid, target) {
  const res = canPlace(ctx, uid, target);
  if (!res.ok) return null;
  if (res.action === 'art') return { t: 'g.art', fields: { itemUid: uid, row: target.row, col: target.col } };
  if (res.action === 'equip') {
    const occ = target.area === 'hand' ? ctx.handAt.get(target.idx) : ctx.boardAt.get(tileKey(target.row, target.col));
    // both slots used: the replace dialog picks the equipped item to destroy (g.equip replaceUid) — unless the item is
    // consumed on equip, or it completes an item merge (the server merges it instead of equipping: nothing replaced)
    const full = Array.isArray(occ?.piece?.items) && occ.piece.items.length >= 2
      && itemAttaches(ctx.getItem(ctx.pieces.get(uid)?.piece?.id)) && !equipMerges(ctx, uid);
    return { t: 'g.equip', fields: { itemUid: uid, targetUid: occ.piece.uid }, confirmReplace: full };
  }
  const to = target.area === 'hand' ? { area: 'hand', idx: target.idx } : { area: 'board', row: target.row, col: target.col };
  return { t: 'g.move', fields: { uid, to } };
}

/**
 * Why a drag released over the field was refused (null when there is nothing to say): the canPlace reason for a
 * board tile / hand slot, a generic line for other tiles of the own board rows (lanes, blocked tiles) and the
 * temporary bench. Releasing on the piece's own slot or far from the board says nothing.
 * @param {ReturnType<typeof placementContext>} ctx
 * @param {number} uid
 * @param {{row:number, col:number, area?:string|null, idx?:number}|null} tile last hovered tile (render tileHover)
 * @returns {string|null}
 */
export function dropFailureReason(ctx, uid, tile) {
  if (!ctx?.editable || !ctx.pieces?.get(uid) || !isObj(tile)) return null;
  let target = null;
  if (tile.area === 'board') target = { area: 'board', row: tile.row, col: tile.col };
  else if (tile.area === 'hand') target = { area: 'hand', idx: Number.isInteger(tile.idx) ? tile.idx : tile.col };
  else if (tile.area === 'temp') return ctx.pieces.get(uid).area === 'temp' ? null : '临时整备区无法放入单位';
  else if (Number.isInteger(tile.row) && tile.row >= GEO.FIELD.r0 && tile.row <= GEO.FIELD.r1) return '无法部署在该位置';
  else return null;
  const res = canPlace(ctx, uid, target);
  if (res.ok || res.code === 'ALREADY') return null;
  return res.reason || '无法放置在该位置';
}

// ---- 机变 / band draft normalisation ----------------------------------------------------------------------

/**
 * Normalise m.public.draft ({order, turn, picks, skips?}) — tolerant of index/playerId turns and
 * object/array picks.
 * @param {any} draft
 * @param {any[]} [players]
 * @returns {{ order: string[], turnPid: string|null, picks: Map<string,string>, skipsLeft: Map<string, number>, done: boolean }}
 */
export function normalizeDraft(draft, players = []) {
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(draft?.order) && draft.order.length ? draft.order.filter((x) => typeof x === 'string') : ids;
  let turnPid = null;
  if (typeof draft?.turn === 'string') turnPid = draft.turn;
  else if (Number.isInteger(draft?.turn) && draft.turn >= 0 && draft.turn < order.length) turnPid = order[draft.turn];
  const picks = new Map();
  const src = draft?.picks;
  if (Array.isArray(src)) {
    src.forEach((v, i) => {
      if (typeof v === 'string' && order[i]) picks.set(order[i], v);
      else if (isObj(v) && typeof v.playerId === 'string' && typeof v.bandId === 'string') picks.set(v.playerId, v.bandId);
    });
  } else if (isObj(src)) {
    for (const [k, v] of Object.entries(src)) if (typeof v === 'string' && v) picks.set(k, v);
  }
  const skipsLeft = new Map();
  const sk = draft?.skipsLeft ?? draft?.skips;
  if (isObj(sk)) for (const [k, v] of Object.entries(sk)) if (Number.isFinite(v)) skipsLeft.set(k, v);
  const done = order.length > 0 && order.every((pid) => picks.has(pid));
  return { order, turnPid, picks, skipsLeft, done };
}

/**
 * Normalise m.public.sp ({family, cards, turn, picks, order?}).
 * Cards: string ids or objects; picks: {playerId: cardIdx} | [{playerId, idx}] | card.takenBy.
 * @param {any} sp
 * @param {any[]} [players]
 */
export function normalizeSp(sp, players = []) {
  if (!isObj(sp)) return null;
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(sp.order) && sp.order.length ? sp.order.filter((x) => typeof x === 'string') : ids;
  const cards = (Array.isArray(sp.cards) ? sp.cards : []).slice(0, 6).map((c, idx) => {
    const card = typeof c === 'string' ? { id: c } : isObj(c) ? { ...c } : {};
    return { ...card, idx, takenBy: typeof card.takenBy === 'string' ? card.takenBy : null };
  });
  const takenBy = new Map(); // idx → playerId
  const pickOf = new Map(); // playerId → idx
  const src = sp.picks;
  const add = (pid, idx) => {
    if (typeof pid !== 'string' || !Number.isInteger(idx) || idx < 0 || idx >= cards.length) return;
    takenBy.set(idx, pid);
    pickOf.set(pid, idx);
  };
  if (Array.isArray(src)) src.forEach((v, i) => { if (isObj(v)) add(v.playerId, v.idx); else if (Number.isInteger(v) && order[i]) add(order[i], v); });
  else if (isObj(src)) for (const [k, v] of Object.entries(src)) add(k, v);
  if (isObj(sp.taken)) for (const [k, v] of Object.entries(sp.taken)) add(v, Number(k));
  for (const c of cards) if (c.takenBy) add(c.takenBy, c.idx);
  for (const c of cards) c.takenBy = takenBy.get(c.idx) ?? null;
  let turnPid = null;
  if (typeof sp.turn === 'string') turnPid = sp.turn;
  else if (Number.isInteger(sp.turn) && sp.turn >= 0 && sp.turn < order.length) turnPid = order[sp.turn];
  return {
    family: typeof sp.family === 'string' ? sp.family : null,
    name: typeof sp.name === 'string' && sp.name ? sp.name : null,
    desc: typeof sp.desc === 'string' && sp.desc ? sp.desc : null,
    untimed: !!sp.untimed,
    cards, order, turnPid, pickOf, takenBy, pickedCount: pickOf.size,
  };
}

// ---- enemies ------------------------------------------------------------------------------------------------

const TAG_ORDER = { boss: 0, bounty: 1, escort: 2 };
const RANK_ORDER = { BOSS: 0, ELITE: 1, NORMAL: 2 };

/**
 * Next-round enemy preview rows: merged by (enemyKey, tag), sorted boss → bounty → elite → normal → count.
 * @param {Array<{enemyKey:string, count?:number, tag?:string}>} list
 * @param {(key:string)=>any} [getEnemy]
 */
export function groupEnemies(list, getEnemy = () => null) {
  const map = new Map();
  for (const e of Array.isArray(list) ? list : []) {
    if (!isObj(e) || typeof e.enemyKey !== 'string') continue;
    const tag = typeof e.tag === 'string' ? e.tag : null;
    const k = `${e.enemyKey}|${tag}`;
    const cur = map.get(k) || { enemyKey: e.enemyKey, tag, count: 0 };
    cur.count += Number.isFinite(e.count) && e.count > 0 ? e.count : 1;
    map.set(k, cur);
  }
  return [...map.values()].map((row) => {
    const en = getEnemy(row.enemyKey);
    return { ...row, name: en?.name || row.enemyKey, rank: en?.rank || 'NORMAL', acTypes: Array.isArray(en?.acTypes) ? en.acTypes : (en?.acType ? [en.acType] : []), fly: en?.stats?.motion === 'FLY' || !!en?.isFlyEnemy };
  }).sort((a, b) => (TAG_ORDER[a.tag] ?? 9) - (TAG_ORDER[b.tag] ?? 9)
    || (RANK_ORDER[a.rank] ?? 9) - (RANK_ORDER[b.rank] ?? 9)
    || b.count - a.count || (a.enemyKey < b.enemyKey ? -1 : 1));
}

// ---- enemy preview pen (research 09 §2, research 08 §4.2) ---------------------------------------------------

/** Pen rect and zones: rows 14–18 × cols 7–13, row 16 unused; lower-gate zone rows 14–15, upper-gate zone rows 17–18. */
export const PEN = Object.freeze({ r0: 14, r1: 18, c0: 7, c1: 13, emptyRow: 16, cap: 50, anchors: Object.freeze({ lower: [15, 7], upper: [18, 7] }) });

/** Zone tiles in row-major order (low row first, col 7→13), without the zone's anchor (tile_start) — 13 per zone. */
export function penZoneTiles(gate) {
  const rows = gate === 'upper' ? [17, 18] : [14, 15];
  const [ar, ac] = PEN.anchors[gate === 'upper' ? 'upper' : 'lower'];
  const out = [];
  for (const r of rows) for (let c = PEN.c0; c <= PEN.c1; c++) if (!(r === ar && c === ac)) out.push([r, c]);
  return out;
}

/**
 * Placement of the preview models in the pen for the DOM fallback view — the SAME layout as the render engine
 * (render/pen.js layoutPen: research 08 §4.2, client AutoChessEnemyPreviewManager — spawn-time order; > 50 enemies
 * thinned per entry to max(1, round(count·50/total)), elites / leaders always all of theirs; each gate's models in its
 * zone, the k-th model of a zone at zoneTiles[round(k/totalShowCnt·len) − jitter]; ≤ 3 per tile; seeded, so a re-sent
 * m.private never reshuffles it). Both views show one teammate's pen identically (review regression: the fallback used
 * its own variant — global k, no per-tile cap — and placed the same enemies elsewhere). `slot` numbers the models
 * sharing a tile.
 * @param {Array<{ enemyKey: string, count?: number, gate?: string, t?: number, fly?: boolean, elite?: boolean, boss?: boolean }>} entries m.private.nextEnemies
 * @param {{ cap?: number, stage?: any }} [opts] cap = MAX_PREVIEW_CNT (50); stage = the stage (its pen rect / tiles)
 * @returns {Array<{ enemyKey: string, gate: 'upper'|'lower', row: number, col: number, slot: number, fly: boolean, elite: boolean, boss: boolean, k: number }>}
 */
export function penPlacement(entries, opts = {}) {
  const max = Number.isInteger(opts.cap) && opts.cap > 0 ? opts.cap : PEN.cap;
  const { figures } = layoutPen(Array.isArray(entries) ? entries : [], { stage: opts.stage || null, max });
  const perTile = new Map();
  return figures.map((f, k) => {
    const key = `${f.row},${f.col}`;
    const slot = perTile.get(key) || 0;
    perTile.set(key, slot + 1);
    return { enemyKey: f.enemyKey, gate: f.zone === 'upper' ? 'upper' : 'lower', row: f.row, col: f.col, slot, fly: !!f.fly, elite: !!f.elite, boss: !!f.boss, k };
  });
}

/**
 * The enemy a view `pieceClick` points at in the preview pen, or null: `{ enemyKey }` or a `preview` enemy unit
 * (`{ preview: true, unit: { side: 'enemy', defId } }`). Battle units (live fights) are not pen enemies.
 * @param {any} e
 */
export function previewEnemyKey(e) {
  if (!isObj(e)) return null;
  if (typeof e.enemyKey === 'string' && e.enemyKey) return e.enemyKey;
  const u = isObj(e.unit) ? e.unit : null;
  if (!u || !(e.preview || u.preview)) return null;
  if (u.side !== 'enemy' && u.kind !== 'enemy') return null;
  const k = typeof u.enemyKey === 'string' && u.enemyKey ? u.enemyKey : u.defId;
  return typeof k === 'string' && k ? k : null;
}

/** Normalise m.public.factions (type strings or objects) to type ids. */
export function factionTypes(factions) {
  const out = [];
  for (const f of Array.isArray(factions) ? factions : []) {
    const t = typeof f === 'string' ? f : isObj(f) ? (f.type || f.id || f.key) : null;
    if (typeof t === 'string' && t && !out.includes(t)) out.push(t);
  }
  return out;
}

// ---- snapshots / battle HUD ---------------------------------------------------------------------------------

/**
 * HUD numbers from a b.snap: { killed, total, dp, boss } (boss: { hp, max } when present).
 * @param {any} snap
 */
export function snapHud(snap) {
  if (!isObj(snap)) return null;
  const n = (v) => (Number.isFinite(v) ? v : null);
  let boss = null;
  if (isObj(snap.boss) && Number.isFinite(snap.boss.hp)) boss = { hp: snap.boss.hp, max: n(snap.boss.max) ?? n(snap.boss.maxHp) };
  return { killed: n(snap.killed), total: n(snap.total), dp: n(snap.dp), boss };
}

/** Boss HP fraction 0..1 (null when unknown). */
export function bossFrac(bossHp) {
  if (!isObj(bossHp)) return null;
  const hp = Number(bossHp.hp);
  const max = Number(bossHp.max ?? bossHp.maxHp);
  if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return null;
  return clamp(hp / max, 0, 1);
}

/**
 * The boss bar's percentage text for a fraction (bossFrac): whole percents from 10 %, one decimal below, and never
 * "0.0%" while the leader still has HP — a sliver reads "<0.1%" (user playtest #6 item 5: a bar at 0.0 % with the
 * leader still fighting read as a leader that could not die). null for an unknown fraction.
 * @param {number|null} frac
 */
export function bossPctText(frac) {
  if (frac == null || !Number.isFinite(frac)) return null;
  const pct = clamp(frac, 0, 1) * 100;
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  if (pct > 0 && pct < 0.05) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

/** Whether a snapshot unit tuple has a flag. */
export const hasFlag = (flags, bit) => (Number(flags) & bit) !== 0;
export { UF };

// ---- stats & range --------------------------------------------------------------------------------------------

/** Attack interval in seconds (bat × 100 / aspd). */
export function attackInterval(bat, aspd = 100) {
  const b = Number(bat);
  const a = Number(aspd) > 0 ? Number(aspd) : 100;
  if (!Number.isFinite(b) || b <= 0) return null;
  return b * 100 / a;
}

/** Compact number: 12345 → '12,345'; 1.5e6 → '150万'. */
export function fmtNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}亿`;
  if (Math.abs(n) >= 1e5) return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万`;
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Bounding box + cell set of a range grid (always including the own tile [0,0]); `mirror` flips columns.
 * @param {Array<[number, number]>} grid [[dRow, dCol], …]
 * @param {boolean} [mirror]
 * @returns {{ rows: number, cols: number, r0: number, c0: number, cells: Set<string>, self: [number, number] }}
 */
export function rangeGridBox(grid, mirror = false) {
  const cells = new Set();
  let minR = 0; let maxR = 0; let minC = 0; let maxC = 0;
  for (const g of Array.isArray(grid) ? grid : []) {
    if (!Array.isArray(g) || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) continue;
    const r = g[0];
    const c = mirror ? -g[1] : g[1];
    cells.add(tileKey(r, c));
    minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c);
  }
  return { rows: maxR - minR + 1, cols: maxC - minC + 1, r0: maxR, c0: minC, cells, self: [0, 0] };
}

// ---- keyboard ---------------------------------------------------------------------------------------------------

/**
 * Map a keydown to a game shortcut (R refresh, F freeze, D level-up, Q retreat, X sell, Space ready, Esc close).
 * Space means ready even while a HUD button has focus (a mouse click leaves the shop card / 刷新 focused, and
 * Space must not re-trigger it); the caller prevents the button's own activation. Enter still activates buttons.
 * @param {{ key?: string, code?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, repeat?: boolean, target?: any }} e
 * @returns {'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'|'escape'|null}
 */
export function shortcutFor(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target;
  const tag = t && typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return null;
  if (e.key === 'Escape') return 'escape';
  if (e.repeat) return null;
  const code = e.code || '';
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  if (code === 'KeyR' || key === 'r') return 'refresh';
  if (code === 'KeyF' || key === 'f') return 'freeze';
  if (code === 'KeyD' || key === 'd') return 'levelUp';
  if (code === 'KeyQ' || key === 'q') return 'retreat';
  if (code === 'KeyX' || key === 'x') return 'sell';
  if (code === 'Space' || key === ' ') return 'ready';
  return null;
}

/**
 * Whether a press on the field closes the open detail card: a card opened from the field itself (an own piece — tap,
 * right-click or long press — or a battle / teammate unit). Shop, reward, bond-member and intel (enemy) cards stay.
 * @param {{ kind?: string }|null|undefined} detail
 */
export const closesOnFieldPress = (detail) => detail?.kind === 'piece' || detail?.kind === 'unit';

/**
 * Whether an open overlay swallows a game shortcut: a modal / the guide own the keyboard (Esc included — they close
 * themselves); the 本局信息 / 敌方情报 drawer is a dialog too — only Esc (it closes the drawer) passes, R / F / D / Space
 * never act behind it.
 * @param {'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready'|'escape'|null} act shortcutFor
 * @param {{ modal?: boolean, drawer?: boolean }} open
 */
export function shortcutBlocked(act, { modal = false, drawer = false } = {}) {
  if (!act) return true;
  if (modal) return true;
  return !!drawer && act !== 'escape';
}

// ---- settings ------------------------------------------------------------------------------------------------------

export const DEFAULT_SETTINGS = Object.freeze({ bgm: 0.6, sfx: 0.8, voice: 0.8, muted: false, damageNumbers: true, quality: 'high' });
const QUALITIES = ['high', 'medium', 'low'];

/**
 * Sanitize persisted settings.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, muted: boolean, damageNumbers: boolean, quality: 'high'|'medium'|'low' }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  return {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
  };
}

// ---- result -----------------------------------------------------------------------------------------------------------

/**
 * Normalise an m.result payload (free-form; see screens/result.js header for the expected shape).
 * @param {any} res
 * @param {any} pub last m.public (fallbacks)
 */
export function normalizeResult(res, pub) {
  const r = isObj(res) ? res : {};
  const pubPlayers = new Map(sortedPlayers(pub).map((p) => [p.playerId, p]));
  // From the 最终攻势 on, every survivor's LP is one merged pool (m.public teamLp) and leaks / overtime only drain
  // that pool: a survivor's remaining LP is the pool, not its own LP from before the Final Assault.
  const teamLp = Number.isFinite(r.teamLp) ? r.teamLp : Number.isFinite(pub?.teamLp) ? pub.teamLp : null;
  const players = (Array.isArray(r.players) ? r.players : []).filter(isObj).map((p) => {
    const pp = pubPlayers.get(p.playerId) || {};
    const title = typeof p.title === 'string' ? { id: p.title } : isObj(p.title) ? p.title : null;
    const alive = p.alive ?? pp.alive ?? true;
    const ownLp = Number.isFinite(p.lp) ? p.lp : (Number.isFinite(pp.lp) ? pp.lp : null);
    return {
      playerId: p.playerId,
      seat: int(p.seat, int(pp.seat, 0)),
      name: p.name || pp.name || '博士',
      isBot: !!(p.isBot ?? pp.isBot),
      alive,
      lp: teamLp != null ? (alive === false ? 0 : Math.max(0, teamLp)) : ownLp,
      lpShared: teamLp != null,
      bandId: p.bandId ?? pp.bandId ?? null,
      roundsPassed: Number.isFinite(p.roundsPassed) ? p.roundsPassed : (Number.isFinite(r.roundsPassed) ? r.roundsPassed : 0),
      title,
      lineup: (Array.isArray(p.lineup) ? p.lineup : Array.isArray(p.board) ? p.board : []).filter(isObj).slice(0, 12),
      bonds: (Array.isArray(p.bonds) ? p.bonds : Array.isArray(pp.bonds) ? pp.bonds : []).filter(isObj),
      stats: isObj(p.stats) ? p.stats : {},
      trophies: Number.isFinite(p.trophies) ? p.trophies : 0,
      reward: Number.isFinite(p.reward) ? p.reward : 0,
      left: !!p.left,
    };
  }).sort((a, b) => a.seat - b.seat);
  return {
    victory: !!r.victory,
    roundsPassed: Number.isFinite(r.roundsPassed) ? r.roundsPassed : Math.max(0, ...players.map((p) => p.roundsPassed), 0),
    lastRound: Number.isFinite(r.lastRound) ? r.lastRound : (Number.isFinite(pub?.lastRound) ? pub.lastRound : 14),
    hiddenCleared: !!r.hiddenCleared,
    // the Hidden Core (R15) was fought: only then does the result show its boss medal (m.result.hiddenReached;
    // older payloads without it: a clear implies it was reached)
    hiddenReached: typeof r.hiddenReached === 'boolean' ? (r.hiddenReached || !!r.hiddenCleared) : !!r.hiddenCleared,
    difficulty: r.difficulty || pub?.difficulty || null,
    modeId: r.modeId || pub?.modeId || null,
    bossId: r.bossId ?? pub?.bossId ?? null,
    hiddenBossId: r.hiddenBossId ?? pub?.hiddenBossId ?? null,
    durationMs: Number.isFinite(r.durationMs) ? r.durationMs : null,
    players,
  };
}

// ---- operator loadout (DESIGN §16) ----------------------------------------------------------------------------------

/**
 * The skill / module a chess fights with under the player's loadout (m.private.loadout, DESIGN §16) — what the shop
 * card and the detail panel show. Works with data that already lists every selectable skill (`skills[]`, elite
 * `modules[]`) and with older data (only the default `skill` / `module`).
 * @param {any} chess the chess record (normal or elite)
 * @param {any} loadout m.private.loadout `{ [baseChessId]: { skill, module } }` (entries equal to the defaults may be
 *   missing); null → defaults
 * @param {(id: string) => any} [getChess]
 * @returns {{ skill: any, skillIndex: number|null, defaultSkill: boolean, module: { id: string, name: string, typeName: string, none: boolean }|null,
 *   defaultModule: boolean, changed: boolean, choices: number } | null}
 */
export function chessLoadout(chess, loadout, getChess = () => null) {
  if (!isObj(chess)) return null;
  const lo = isObj(loadout) && !Array.isArray(loadout) ? loadout : null;
  let r = { skillIndex: null, moduleId: null };
  try { r = resolveLoadout(lo, chess, getChess); } catch { /* defaults */ }
  const skills = Array.isArray(chess.skills) && chess.skills.length ? chess.skills.filter(isObj) : (isObj(chess.skill) ? [chess.skill] : []);
  const skill = skills.find((s) => s.index === r.skillIndex) || (isObj(chess.skill) ? chess.skill : null) || skills[0] || null;
  const base = chess.isGolden ? (getChess(chess.baseId) || chess) : chess;
  let opt = { defaultSkill: null, defaultModule: null, skills: [] };
  try { opt = loadoutOptions(base, chess.isGolden ? chess : null); } catch { /* defaults */ }
  const defIdx = opt.defaultSkill ?? chess.skill?.index ?? null;
  const defaultSkill = !skill || skill.index == null || defIdx == null || skill.index === defIdx;
  let module = null;
  let defaultModule = true;
  if (chess.isGolden) {
    const id = r.moduleId ?? (chess.module?.active ? chess.module.id : MODULE_NONE);
    if (id === MODULE_NONE) module = { id: MODULE_NONE, name: '未装备模组', typeName: '', none: true };
    else {
      const rec = (Array.isArray(chess.modules) ? chess.modules : []).find((m) => isObj(m) && m.uniEquipId === id)
        || (isObj(chess.module) && chess.module.id === id ? { uniEquipId: id, name: chess.module.name, typeName: chess.module.type } : null);
      module = { id, name: rec?.name || id, typeName: rec?.typeName || rec?.type || '', none: false };
    }
    defaultModule = opt.defaultModule == null || id === opt.defaultModule;
  }
  // the record the unit fights with (stats / 特性 / talents of the chosen module or none — the battle's own composition,
  // shared/loadoutRecord.js): the detail card must show what the sim runs
  let record = chess;
  try { record = loadoutRecord(chess, resolveRecordLoadout(chess, { skillIndex: r.skillIndex, moduleId: r.moduleId })) || chess; } catch { /* the record as is */ }
  return { skill, skillIndex: skill?.index ?? null, defaultSkill, module, defaultModule, changed: !defaultSkill || !defaultModule,
    choices: Math.max(skills.length, opt.skills?.length || 0), record };
}

/**
 * The loadout (m.private.loadout shape) a battle / scouting unit fights with, from the unit itself — a teammate's
 * operator shows ITS owner's skill / module (DESIGN §16), not the viewer's nor the defaults: UnitInfo `skillIndex`
 * (sim units, prep scouting m.field units) and `moduleId` (elite only), keyed by the chess's base id for chessLoadout.
 * Null when the unit carries neither (the defaults).
 * @param {any} chess the unit's chess record (normal or elite)
 * @param {any} unit UnitInfo
 * @returns {Record<string, { skill?: number, module?: string }> | null}
 */
export function unitLoadout(chess, unit) {
  if (!isObj(chess) || !isObj(unit)) return null;
  const baseId = chess.baseId || chess.chessId;
  if (typeof baseId !== 'string' || !baseId) return null;
  const e = {};
  if (Number.isInteger(unit.skillIndex) && unit.skillIndex >= 0) e.skill = unit.skillIndex;
  if (chess.isGolden && typeof unit.moduleId === 'string' && unit.moduleId) e.module = unit.moduleId;
  return Object.keys(e).length ? { [baseId]: e } : null;
}

// ---- detail panel placement (user playtest #2 item 8) ---------------------------------------------------------------

/**
 * Which side the detail panel goes to so it never covers the selected unit's underframe: the default 'left' panel
 * unless the underframe (buttons included) overlaps it and the 'right' slot is clear of it (else 'left' — the
 * underframe is drawn above the panel anyway, css z-index).
 * @param {{ left: number, right: number, top: number, bottom: number }|null} uf underframe rect (client px)
 * @param {{ left: {left:number,right:number,top:number,bottom:number}, right: {left:number,right:number,top:number,bottom:number} }} slots
 * @returns {'left'|'right'}
 */
export function panelSide(uf, slots) {
  if (!isObj(uf) || !isObj(slots)) return 'left';
  const hit = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  if (!hit(uf, slots.left)) return 'left';
  return hit(uf, slots.right) ? 'left' : 'right';
}

/**
 * Client-px rects of the two detail panel slots (css .dpanel / .dpanel--right in rem): left at 2.3rem, right against
 * the right edge above the shop bar when it is open.
 * @param {{ width: number, height: number, left?: number, top?: number }} vp the HUD layer's box (.gm__hud): its size,
 *   and its client offset — the HUD sits inside the safe-area insets (css/devices.css), so on a notched phone the
 *   panels start `left` / `top` px further in than the viewport edge (default 0: the whole viewport)
 * @param {number} rem root font size (px)
 * @param {{ shopOpen?: boolean }} [o]
 */
export function panelSlots(vp, rem, { shopOpen = false } = {}) {
  const W = Number(vp?.width) || 1920;
  const H = Number(vp?.height) || 1080;
  const X = Number.isFinite(vp?.left) ? vp.left : 0;
  const Y = Number.isFinite(vp?.top) ? vp.top : 0;
  const R = rem > 0 ? rem : 100;
  const top = R * 2.1;
  const leftH = Math.min(R * 8.4, H - top - R * 1.02);
  const rightBottom = H - R * (shopOpen ? PANEL_RIGHT_BOTTOM_SHOP : PANEL_RIGHT_BOTTOM);
  return {
    left: { left: X + R * 2.3, right: X + R * (2.3 + 4.9), top: Y + top, bottom: Y + top + leftH },
    right: { left: X + W - R * (PANEL_RIGHT_GAP + 4.9), right: X + W - R * PANEL_RIGHT_GAP, top: Y + top, bottom: Y + Math.max(top + R, rightBottom) },
  };
}
/** Right detail panel slot insets (rem; keep in sync with css/screens/game-panels.css .dpanel--right). */
export const PANEL_RIGHT_GAP = 0.9;
export const PANEL_RIGHT_BOTTOM = 1.02;
export const PANEL_RIGHT_BOTTOM_SHOP = 3.78;

/** Bond popup geometry (rem; keep in sync with css/screens/game-panels.css .bpop / .bpop--*). */
export const BPOP = Object.freeze({ width: 5.4, top: 2.1, bottomGap: 0.3, left: 2.3, beside: 7.32, besideR: 5.92, right: 0.9 });

/**
 * Where the bond popup opens (css .bpop--<place>) so it neither hides the open detail card nor covers the selected
 * unit's underframe (user playtest #2 items 8 / 9): next to the card first ('beside' the left card, 'besideR' left of
 * the right card), else the free side of the screen ('left' at 2.3rem / 'right' against the right edge), else over the
 * card it was opened from; without a card the popup's usual place is 'left'. When every candidate covers the
 * underframe the first one is kept (the underframe is drawn above the popup, css z-index).
 * @param {{ left: number, right: number, top: number, bottom: number }|null} uf underframe rect (client px) or null
 * @param {{ width: number, height: number, left?: number, top?: number }} vp the HUD layer's box (see panelSlots)
 * @param {number} rem root font size (px)
 * @param {'left'|'right'|null} card side of the open detail card (null: none)
 * @returns {'left'|'beside'|'besideR'|'right'}
 */
export function bondPopupPlace(uf, vp, rem, card = null) {
  const W = Number(vp?.width) || 1920;
  const H = Number(vp?.height) || 1080;
  const X = Number.isFinite(vp?.left) ? vp.left : 0;
  const Y = Number.isFinite(vp?.top) ? vp.top : 0;
  const R = rem > 0 ? rem : 100;
  const top = Y + R * BPOP.top;
  const bottom = Y + Math.max(R * BPOP.top + R, H - R * BPOP.bottomGap);
  const rectOf = (p) => {
    const left = X + (p === 'left' ? R * BPOP.left : p === 'beside' ? R * BPOP.beside
      : p === 'besideR' ? W - R * (BPOP.besideR + BPOP.width) : W - R * (BPOP.right + BPOP.width));
    return { left, right: left + R * BPOP.width, top, bottom };
  };
  // last resort: over the card it was opened from (closing the popup shows the card again)
  const order = card === 'left' ? ['beside', 'right', 'left'] : card === 'right' ? ['besideR', 'left', 'right'] : ['left', 'right'];
  if (!isObj(uf)) return order[0];
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return order.find((p) => !hit(uf, rectOf(p))) || order[0];
}
