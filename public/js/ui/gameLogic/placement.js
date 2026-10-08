// ui/gameLogic/placement.js — deploy maps and the canPlace mirror of the server rules. Re-exported from ../gameLogic.js.

import { GEO } from '../../../../shared/constants.js';
import { attackRangeGrid } from '../../../../shared/loadoutRecord.js';
import { meleeOnHighGround } from '../../../../shared/highGround.js';
import { pieceDir, rangeTiles } from '../facing.js';
import { isObj, tileKey } from './shared.js';
import { boardTileOf, fieldTile } from './camera.js';
import { deployedRecord, fieldsStandIn, standInOf } from './standIn.js';
import { t } from '../../../../shared/i18n.js';


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
export function placementContext({ priv, stage, editable, field = 'normal', getChess = () => null, getToken = () => null, getItem = () => null, getEffect = () => null, backups = null }) {
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
  return { priv, pieces, boardAt, handAt, deploy, cap, count, field, editable: !!editable, getChess, getToken, getItem, backups };
}

/**
 * Deploy position ('MELEE'|'RANGED'|'ALL') of a chess/token piece, or null for items. A MELEE chess whose trait reads
 * 「可以放置于远程位」 (shared/highGround.js: 歌蕾蒂娅, 崖心, 见行者, normal and elite, any module) is 'ALL': any deployable
 * tile, the 高台 included (server/match/board.js positionClass; the owner's decision of 2026-10-05). Every other MELEE
 * chess is ground-only.
 */
export function piecePosition(ctx, piece) {
  if (!isObj(piece)) return null;
  if (piece.kind === 'chess') {
    const chess = ctx.getChess(piece.id);
    // 0.2.0 补位: a chess the player fields as its stand-in is placed by the stand-in's position (server placeClass)
    const rec = (fieldsStandIn(ctx.priv, chess) && standInOf(chess, ctx.backups)) || chess;
    if (meleeOnHighGround(rec)) return 'ALL';
    return rec?.position === 'MELEE' ? 'MELEE' : 'RANGED';
  }
  // tokens: MELEE → ground only; RANGED / ALL → any deployable tile; `rangedTilesOnly` (战术锚点 "仅可以部署在…远程位")
  // → 'HIGH', the ranged tiles only (server/match/board.js positionClass 'high')
  if (piece.kind === 'token') {
    const t = ctx.getToken(piece.id);
    if (t?.rangedTilesOnly === true) return 'HIGH';
    return t?.position === 'MELEE' ? 'MELEE' : 'RANGED';
  }
  return null;
}

/** Whether a unit piece (chess/token) may stand on a board tile. */
export function tileAllows(ctx, piece, row, col) {
  const pos = piecePosition(ctx, piece);
  if (!pos) return false;
  const k = tileKey(row, col);
  if (pos === 'HIGH') return ctx.deploy.ranged.has(k) && !ctx.deploy.melee.has(k);
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
  return ownerRangeOf(ctx, piece, owner);
}

/**
 * Board tiles ('r,c') an outside-bound summon may NOT stand on — its owner's attack range (tokens.json
 * `ownerRangeOutside`: 凯尔希·思衡托's 战术锚点 "仅可以部署在凯尔希·思衡托攻击范围外的远程位") — or null. Mirror of
 * server/match/player/placement.js summonExcluded.
 * @param {ReturnType<typeof placementContext>} ctx
 * @returns {Set<string> | null}
 */
export function summonExcluded(ctx, piece, owner = null) {
  if (!isObj(piece) || piece.kind !== 'token' || ctx?.getToken?.(piece.id)?.ownerRangeOutside !== true) return null;
  return ownerRangeOf(ctx, piece, owner);
}

/** The attack-range tiles of a summon piece's owner on the board (summonRange / summonExcluded), or null. */
function ownerRangeOf(ctx, piece, owner = null) {
  let at = owner;
  if (!at) for (const e of ctx.boardAt.values()) if (e.piece.uid === piece.ownerUid && e.piece.kind === 'chess') { at = e; break; }
  const rec = at && ctx.getChess(at.piece.id);
  if (!rec) return null;
  let grid = null;
  try { grid = attackRangeGrid(deployedRecord(rec, ctx.priv, ctx.getChess, ctx.backups) || rec); } catch { /* the data grid */ }
  return new Set(rangeTiles(grid || rec.rangeGrid, at.row, at.col, pieceDir(at.piece)).map(([r, c]) => tileKey(r, c)));
}

/** tileAllows plus the owner-range rules of a range-bound summon (summonRange, summonExcluded). */
function unitAllowed(ctx, piece, row, col, owner = null) {
  if (!tileAllows(ctx, piece, row, col)) return false;
  const k = tileKey(row, col);
  const range = summonRange(ctx, piece, owner);
  if (range && !range.has(k)) return false;
  const out = summonExcluded(ctx, piece, owner);
  return !out || !out.has(k);
}

/**
 * Placement legality of dropping piece `uid` on `target` (mirror of server/match/PlayerState.js move / equip /
 * useArt and server/match/board.js canPlace):
 *   board ← chess: legal tile for its position; empty tile or a chess occupant (swap; from the board the occupant
 *     must be legal on the source tile); from hand/temp the deploy cap applies unless a chess occupant swaps out.
 *   board ← token: legal tile; from the hand the tile must be empty and its summoner deployed; board ↔ board swaps.
 *   hand ← chess from the board: empty slot (withdraw), chess occupant (swap, legal on the source tile), otherwise
 *     it uses a free slot or one freed by its own summon stack (HAND_FULL when none). hand ← token from the board:
 *     always (back onto its stack).
 *   hand ← hand/temp piece: move / swap. hand ← EQUIP item onto a chess: equip; onto a non-chess: swap.
 *   board ← EQUIP item: equip the chess on that tile. board ← MAGIC (Arts): used on that tile.
 * @param {ReturnType<typeof placementContext>} ctx
 * @param {number} uid
 * @param {{area:'board',row:number,col:number}|{area:'hand',idx:number}|{area:'outside'}} target
 * @returns {{ ok: boolean, action?: 'move'|'swap'|'orient'|'equip'|'art', reason?: string, code?: string }}
 */
export function canPlace(ctx, uid, target) {
  const no = (code, reason) => ({ ok: false, code, reason });
  if (!ctx || !ctx.editable) return no('WRONG_PHASE', t('当前阶段无法进行该操作'));
  const src = ctx.pieces.get(uid);
  if (!src) return no('BAD_TARGET', t('找不到该单位'));
  if (!isObj(target)) return no('BAD_TILE', t('无法部署在该位置'));
  const piece = src.piece;
  const isMagic = piece.kind === 'item' && ctx.getItem(piece.id)?.itemType === 'MAGIC';

  if (target.area === 'hand') {
    const idx = target.idx;
    if (!Number.isInteger(idx) || idx < 0 || idx >= GEO.HAND_SIZE) return no('BAD_TILE', t('无法放置在该位置'));
    if (src.area === 'hand' && src.idx === idx) return no('ALREADY', t('位置未变化'));
    const occ = ctx.handAt.get(idx);
    if (!occ) return { ok: true, action: 'move' };
    if (piece.kind === 'item') {
      if (occ.piece.kind === 'chess') return isMagic ? no('BAD_TARGET', t('该道具需要放置在战场上使用')) : equipCheck(ctx, piece, occ.piece);
      return { ok: true, action: 'swap' };
    }
    if (src.area === 'board') {
      if (piece.kind === 'token') return { ok: true, action: 'move' }; // back onto its stack
      if (occ.piece.kind === 'chess') {
        if (!tileAllows(ctx, occ.piece, src.row, src.col)) return no('BAD_TILE', t('交换后的单位无法部署在原位置'));
        return { ok: true, action: 'swap' };
      }
      // Withdrawal removes the operator's own summon stacks, freeing their hand slots too.
      const free = [...Array(GEO.HAND_SIZE).keys()].some((i) => {
        const p = ctx.handAt.get(i)?.piece;
        return !p || (p.kind === 'token' && p.ownerUid === piece.uid);
      });
      return free ? { ok: true, action: 'move' } : no('HAND_FULL', t('整备区已满'));
    }
    return { ok: true, action: 'swap' };
  }

  if (target.area === 'board') {
    const { row, col } = target;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return no('BAD_TILE', t('无法部署在该位置'));
    const inField = row >= GEO.FIELD.r0 && row <= GEO.FIELD.r1 && col >= GEO.FIELD.c0 && col <= GEO.FIELD.c1;
    if (!inField) return no('BAD_TILE', t('无法部署在该位置'));
    const occ = ctx.boardAt.get(tileKey(row, col));
    if (piece.kind === 'item') {
      if (isMagic) return { ok: true, action: 'art' };
      if (!occ) return no('BAD_TARGET', t('请将装备拖拽至干员身上'));
      return equipCheck(ctx, piece, occ.piece);
    }
    // its own tile: re-orient in place through the direction wheel (research 09 §1.2)
    if (src.area === 'board' && src.row === row && src.col === col) return { ok: true, action: 'orient' };
    if (!tileAllows(ctx, piece, row, col)) {
      const deployable = ctx.deploy.ranged.has(tileKey(row, col));
      const pos = piecePosition(ctx, piece);
      return no('BAD_TILE', deployable && pos === 'MELEE' ? t('近战单位只能部署在地面') : deployable && pos === 'HIGH' ? t('只能部署在远程位') : t('无法部署在该位置'));
    }
    // a range-bound summon (战术点): inside its owner's attack range — seen from the summon's old tile when it is
    // dropped onto its own owner (the two swap); an outside-bound one (战术锚点) outside it
    const ownerSwap = src.area === 'board' && occ && occ.piece.uid === piece.ownerUid ? { row: src.row, col: src.col, piece: occ.piece } : null;
    const range = summonRange(ctx, piece, ownerSwap);
    if (range && !range.has(tileKey(row, col))) return no('BAD_TILE', t('只能部署在召唤者攻击范围内'));
    const out = summonExcluded(ctx, piece, ownerSwap);
    if (out && out.has(tileKey(row, col))) return no('BAD_TILE', t('只能部署在召唤者攻击范围外'));
    if (src.area === 'board') {
      // board → board: move or swap (the occupant must be legal on the source tile — the mover's own summon excepted:
      // a moved operator's summons go back to the hand anyway)
      const ownSummon = occ && occ.piece.kind === 'token' && occ.piece.ownerUid === piece.uid;
      if (occ && !ownSummon && !unitAllowed(ctx, occ.piece, src.row, src.col)) return no('BAD_TILE', t('交换后的单位无法部署在原位置'));
      return { ok: true, action: occ ? 'swap' : 'move' };
    }
    if (piece.kind === 'token') {
      if (occ) return no('BAD_TILE', t('该位置已有单位'));
      const ownerDeployed = [...ctx.boardAt.values()].some((e) => e.piece.uid === piece.ownerUid);
      if (Number.isInteger(piece.ownerUid) && !ownerDeployed) return no('BAD_TARGET', t('召唤者尚未部署'));
      return { ok: true, action: 'move' };
    }
    if ((!occ || occ.piece.kind !== 'chess') && ctx.count >= ctx.cap) return no('BOARD_FULL', t('已达到部署上限'));
    return { ok: true, action: occ ? 'swap' : 'move' };
  }
  return no('BAD_TILE', t('无法放置在该位置'));
}

function equipCheck(ctx, itemPiece, targetPiece) {
  const item = ctx.getItem(itemPiece.id);
  if (item?.itemType === 'MAGIC') return { ok: false, code: 'BAD_TARGET', reason: t('该道具需要放置在战场上使用') };
  if (!isObj(targetPiece) || targetPiece.kind !== 'chess') return { ok: false, code: 'BAD_TARGET', reason: t('装备只能配发给干员') };
  return { ok: true, action: 'equip' };
}

/** Whether an item record is consumed on equip (data `kind` consume_on_equip*: it resolves at once and takes no slot). */
const consumedOnEquip = (item) => typeof item?.kind === 'string' && item.kind.startsWith('consume_on_equip');
/** Item effects that promote the carrier (博士投影): the server refuses them on an elite (builtinMeta 'already elite'). */
const PROMOTE_KEYS = new Set(['use_equip_upgrade_char', 'equip_round_start_upgrade_char']);

/**
 * Whether dropping item `uid` on the chess `targetPiece` opens the replace dialog: its two slots are used and the server
 * would replace one of them — every item, a consume-on-equip one too (PRTS 卫戍协议/帮助 "达到上限强行佩戴会改为替换装备";
 * GitHub #263: the pick is destroyed, then the item resolves and the slot stays free). Not when nothing is replaced: an
 * attaching item that completes an item merge (the server merges it instead of equipping, `equipMerges`) or a
 * 博士投影 on an elite (refused by the server).
 * @param {ReturnType<typeof placementContext>} ctx
 * @param {number} uid
 * @param {any} targetPiece
 */
export function equipReplaces(ctx, uid, targetPiece) {
  if (!Array.isArray(targetPiece?.items) || targetPiece.items.length < 2) return false;
  const rec = ctx.getItem(ctx.pieces.get(uid)?.piece?.id);
  if (!consumedOnEquip(rec)) return !equipMerges(ctx, uid);
  const promotes = Array.isArray(rec.buffs) && rec.buffs.some((b) => PROMOTE_KEYS.has(b?.key));
  return !(promotes && targetPiece.golden);
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
    // both slots used: the replace dialog picks the equipped item to destroy (g.equip replaceUid) — see equipReplaces
    return { t: 'g.equip', fields: { itemUid: uid, targetUid: occ.piece.uid }, confirmReplace: equipReplaces(ctx, uid, occ.piece) };
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
  else if (tile.area === 'temp') return ctx.pieces.get(uid).area === 'temp' ? null : t('临时整备区无法放入单位');
  else if (Number.isInteger(tile.row) && tile.row >= GEO.FIELD.r0 && tile.row <= GEO.FIELD.r1) return t('无法部署在该位置');
  else return null;
  const res = canPlace(ctx, uid, target);
  if (res.ok || res.code === 'ALREADY') return null;
  return res.reason || t('无法放置在该位置');
}
