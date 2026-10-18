// ui/gameLogic/camera.js — prep camera, boss-field tile mapping, owner band. Re-exported from ../gameLogic.js.

import { GEO, PHASE } from '../../../../shared/constants.js';
import { BOSS_ROW_SHIFT, MAX_COL } from '../../render/prepfield.js';
import { int, isObj } from './shared.js';

/** Server-owned random pairs. Seat inference is only for an older server without the field. */
function prepPair(pub, myId) {
  const alive = (Array.isArray(pub?.players) ? pub.players : []).filter(p => isObj(p) && p.alive !== false);
  if (!alive.some(p => p.playerId === myId)) return [];
  if (pub.bossPairs !== undefined) {
    return (Array.isArray(pub.bossPairs) ? pub.bossPairs : []).find(g => Array.isArray(g) && g.includes(myId)) || [];
  }
  const ids = alive.sort((a, b) => int(a.seat, 99) - int(b.seat, 99)).map(p => p.playerId);
  const i = ids.indexOf(myId);
  return ids.slice(i - i % 2, i - i % 2 + 2);
}

/**
 * Camera of the own prep board (research 09 §1.2 "Final Assault, right side", DESIGN §15): in the prep of a boss round
 * (最终攻势 / 隐秘核心: `pub.round` is `bossRound` or `hiddenRound`) the pieces stand on the player's half of the shared
 * boss field — `{ kind: 'bossPrep', opts: { side } }`; the side follows the server's pairing (server/match/
 * finalAssault.js pairPlayers, sent in m.public.bossPairs; the second of a pair is on the mirrored
 * right half 'R', a lone player on 'L'). Any other prep: the own board `{ kind: 'prep', opts: { rect, side: 'L' } }`.
 * @param {any} pub m.public
 * @param {string|null} myId
 * @returns {{ kind: 'prep'|'bossPrep', opts: { rect?: { r0: number, r1: number, c0: number, c1: number }, side: 'L'|'R' } }}
 */
export function prepCamera(pub, myId) {
  const normal = { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L' } };
  const r = pub?.round;
  if (!Number.isInteger(r) || r <= 0 || !(r === pub.bossRound || r === pub.hiddenRound)) return normal;
  const idx = prepPair(pub, myId).indexOf(myId);
  if (idx < 0) return normal; // eliminated / unknown: no board of its own on the boss field
  return { kind: 'bossPrep', opts: { side: idx % 2 === 1 ? 'R' : 'L' } };
}

const BOSS_PREP_PHASES = new Set([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP]);

/**
 * The players framed in green on the team panel (community report of 2026-10-06, item 51: 「同组两个玩家屏幕左边的头像也像原版
 * 那样用绿框框起来」 — the official co-op frame, ui/battle `bg_team_border`): in a boss round (最终攻势 / 隐秘核心) the viewer
 * and its pair partner — from the round's start (回合开始 / 机变 / 休整期: the pairing `prepCamera` reads, the players still
 * in the server's saved pairs — server/match/finalAssault.js pairPlayers) through the fight (the boss field listing the
 * viewer). Empty for a lone player, an eliminated player or a spectator seat (no pair of its own) and in every other
 * round. PR #191 framed the partner alone, in gold (not merged).
 * @param {any} pub m.public @param {string|null} myId
 * @returns {Set<string>}
 */
export function teamFrameIds(pub, myId) {
  const none = new Set();
  if (!pub || !myId) return none;
  const players = Array.isArray(pub.players) ? pub.players.filter(isObj) : [];
  const me = players.find((p) => p.playerId === myId);
  if (!me || me.alive === false) return none;
  const r = pub.round;
  const bossRound = Number.isInteger(r) && r > 0 && (r === pub.bossRound || r === pub.hiddenRound);
  if (pub.phase === PHASE.FINAL_ASSAULT || pub.phase === PHASE.HIDDEN_CORE) {
    const f = (Array.isArray(pub.fields) ? pub.fields : []).find((x) => isObj(x) && (x.kind === 'boss' || x.kind === 'hidden') && Array.isArray(x.players) && x.players.includes(myId));
    return f && f.players.length > 1 ? new Set(f.players) : none;
  }
  if (!bossRound || !BOSS_PREP_PHASES.has(pub.phase)) return none;
  const pair = prepPair(pub, myId);
  return pair.length > 1 ? new Set(pair) : none;
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
 * Whether a deploy interaction temporarily folds the shop and zooms the own prep board (public issue #602 "部署干员、
 * 装备时棋盘缩放": the official client folds the shop and takes the shop-collapsed prep camera while a piece is picked
 * up for 部署干员 / 装备 / repositioning, and while the dropped piece's direction wheel is open, then gives the
 * player's own shop state back — the board was too small to aim on phones): the viewer edits the own prep board
 * (`ownPrep`, `editable`), the camera is not over the enemy pen (`pen`), and a piece is dragged (`drag`) or the
 * direction wheel of a legal drop is open (`facing`; equipment and summons skip the wheel and restore on drop).
 * Unlike a hand-made fold this one never waits for the interaction to end — it zooms as the piece is picked up. It is
 * derived from the interaction state and never writes the player's 收起/展开 state. `enabled` omitted stays on (callers
 * and the default of 设置「部署时收起商店」). Only an explicit false turns the temporary fold off. [ASSUMED] that label.
 * @param {{ ownPrep?: boolean, editable?: boolean, pen?: boolean, drag?: boolean, facing?: boolean, enabled?: boolean }|null|undefined} o
 * @returns {boolean}
 */
export function deployFoldsShop(o) {
  if (!o || o.enabled === false) return false;
  return !!o.ownPrep && !!o.editable && !o.pen && (!!o.drag || !!o.facing);
}

/**
 * Whether this frame's deploy fold should zoom the board, and whether a zoom already applied must be given back now.
 * `zoomed` is the previous frame's deploy zoom (the caller remembers it). Turning 设置「部署时收起商店」 off while a
 * piece is still held (`deployFold` becomes false) releases that zoom on this one frame — later frames of the same
 * drag do not, so a hand-made 收起 during the rest of the drag still waits (issue #5).
 * @param {boolean} zoomed
 * @param {boolean} deployFold
 * @returns {{ release: boolean, zoomed: boolean }}
 */
export function deployZoomStep(zoomed, deployFold) {
  return { release: !!zoomed && !deployFold, zoomed: !!deployFold };
}

/**
 * Whether the deploy zoom is still owed after this frame (`deployZoomedRef`). `step` is `deployZoomStep`;
 * `frame.next` is what `prepDeployCamera` returned for that same step and `frame.pen` is the enemy pen.
 * Turning 设置「部署时收起商店」 off asks for the player's camera on one frame. Opening 敌方情报 during the
 * held drag makes that frame return null (`foldCamera` while `pen`), and forgetting the zoom there left an
 * open shop on the still-zoomed board until the drag ended. A null because the pen is open keeps the zoom
 * owed, so closing the pen still passes `releaseDeploy` while the piece is held. A null only because the
 * camera already matches the player's own fold spends it, so a later hand-made 收起 in that drag still waits.
 * [ASSUMED] no official source settles opening the pen during a held deploy drag.
 * @param {{ release?: boolean, zoomed?: boolean }|null|undefined} step
 * @param {{ next?: object|null, pen?: boolean }|null|undefined} [frame]
 * @returns {boolean}
 */
export function deployZoomRemember(step, frame) {
  if (step?.zoomed) return true;
  return !!step?.release && !frame?.next && !!frame?.pen;
}

/**
 * The prep camera this frame: the deploy zoom when `deployFold` (GitHub #602), else the shop fold's camera
 * (`foldCamera`). `releaseDeploy` skips the busy deferral for the one frame a deploy zoom is given back, so turning
 * the setting off mid-drag cannot leave the camera zoomed. A hand-made fold while the setting is off and no deploy
 * zoom is in effect still defers (`busy`).
 * @param {{ pub: any, myId: string|null, deployFold?: boolean, releaseDeploy?: boolean, folded: boolean,
 *   ownPrep: boolean, pen?: boolean, busy?: boolean,
 *   current?: { kind: string, opts?: { shop?: boolean } }|null }|null|undefined} s
 * @returns {{ kind: 'prep'|'bossPrep', opts: object }|null}
 */
export function prepDeployCamera(s) {
  if (!s) return null;
  if (s.deployFold) {
    const want = prepCameraFor(s.pub, s.myId, true);
    const cur = s.current;
    if (cur && cur.kind === want.kind && cur.opts?.shop === false) return null;
    return want;
  }
  return foldCamera({
    pub: s.pub, myId: s.myId, folded: s.folded, ownPrep: s.ownPrep, pen: s.pen,
    busy: !!s.busy && !s.releaseDeploy, current: s.current,
  });
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
