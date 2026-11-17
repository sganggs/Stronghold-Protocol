// ui/gameLogic/diy.js — 自选编队 pieces in the match UI (0.2.0 DIY; the owner's decisions of 2026-10-05). Re-exported
// from ../gameLogic.js.
//
// A DIY slot (chess_char_5_diy1_a …) has no body of its own (甄选干员): each player's piece of it is the operator that
// player slotted — its name, art, class, bonds (from its factions), the pick's skill and module, no 特质; the slot's tier,
// price and merge. Whose pick: the player's own pieces and cards follow m.private.diy (the picks its seat had when the
// match started — the server's, not this browser's current setting, which applies from the next match); another
// player's units say it themselves (UnitInfo `diy`: the sim's, Match.prepFieldMeta's for scouting, m.result lineups). The
// composed record is shared/diy.js diyRecordOf over chess.json + backups.json — the one the server and the sim use.
// `data` below = `{ chess, backups }` (the client's data.get('chess') / data.get('backups'), localized copies).
// 0.2.2: a pick may carry `potential` (the owner's 潜能 of the operator — m.private.ops for the player's own, UnitInfo
// `potential` for another player's unit): the record is composed at it (an owned pick; a prototype has none).

import { diyRecordOf } from '../../../../shared/diy.js';
import { isObj } from './shared.js';

/** The player's 自选 picks in this match (m.private.diy; {} when absent). */
export function diyPicks(priv) {
  return isObj(priv) && isObj(priv.diy) ? priv.diy : {};
}

/**
 * The pick the player's own piece / card of chess record `chess` fields: its slot's in m.private.diy, or null (not a DIY
 * slot, or one the player did not fill). A composed record (`diyFor`) names its slot itself.
 * @param {any} priv @param {any} chess
 */
export function ownDiyPick(priv, chess) {
  if (!isObj(chess) || !chess.isDiy) return null;
  const slot = typeof chess.diyFor === 'string' ? chess.diyFor : chess.baseId || chess.chessId;
  const p = diyPicks(priv)[slot];
  if (!isObj(p) || typeof p.charId !== 'string') return null;
  // 0.2.2: at the player's 潜能 of that operator (m.private.ops; none set = 6)
  const pot = isObj(priv?.ops) && isObj(priv.ops[p.charId]) ? priv.ops[p.charId].potential : null;
  return Number.isInteger(pot) && pot >= 1 && pot < 6 ? { ...p, potential: pot } : p;
}

/** Per backups object: `chessId|charId|skill|module` → composed record (or null). */
const CACHE = new WeakMap();

/**
 * The 自选 record of DIY slot record `chess` (normal or elite) filled with `pick` (shared/diy.js diyRecordOf), cached
 * per data; null for an illegal pick or missing data.
 * @param {any} chess the slot's own chess.json record @param {any} pick `{ charId, skillIndex, uniEquipId }`
 * @param {{ chess?: any, backups?: any }} data
 */
export function diyRecordFor(chess, pick, data) {
  if (!isObj(chess) || !chess.isDiy) return null;
  if (chess.diyFor) return chess; // already composed
  if (!isObj(pick) || !isObj(data?.backups)) return null;
  let m = CACHE.get(data.backups);
  if (!m) { m = new Map(); CACHE.set(data.backups, m); }
  const pot = Number.isInteger(pick.potential) ? pick.potential : null;
  const key = `${chess.chessId}|${pick.charId}|${pick.skillIndex ?? ''}|${pick.uniEquipId ?? ''}|${pot ?? ''}`;
  if (m.has(key)) return m.get(key);
  let rec;
  try { rec = diyRecordOf(chess, pick, data, { potential: pot }); } catch { rec = null; }
  m.set(key, rec);
  return rec;
}

/** The record the player's own piece / card of `chess` shows: its 自选 record (own pick), or null. */
export function ownDiyRecord(chess, priv, data) {
  const pick = ownDiyPick(priv, chess);
  return pick ? diyRecordFor(chess, pick, data) : null;
}

/**
 * The 自选 record a card of `chess` shows for this viewer, or null: a unit that carries `diy` (another player's — the
 * sim's UnitInfo, prep scouting, a result lineup entry), else the player's own piece / card (m.private.diy).
 * @param {any} chess @param {{ priv?: any, unit?: any, data?: any }} o
 */
export function cardDiy(chess, { priv = null, unit = null, data = null } = {}) {
  if (!isObj(chess) || !chess.isDiy) return null;
  if (unit) return isObj(unit.diy) ? diyRecordFor(chess, unitPick(unit), data) : null;
  return ownDiyRecord(chess, priv, data);
}

/** A unit's 自选 pick with its potential (UnitInfo `diy` + `potential`, 0.2.2), or null. */
export function unitPick(unit) {
  if (!isObj(unit) || !isObj(unit.diy)) return null;
  return Number.isInteger(unit.potential) ? { ...unit.diy, potential: unit.potential } : unit.diy;
}

/**
 * id → the player's 自选 record of a filled DIY slot (both forms), else the chess record: the lookup the player's own
 * pieces and cards resolve against (names, art, position, the loadout / range of a 自选 piece — shared/protocol.js
 * resolveLoadout then reads the pick's skill and module as the record's defaults).
 * @param {(id: string) => any} getChess @param {any} priv m.private (or a getter of the current one) @param {any} data
 */
export function diyGetter(getChess, priv, data) {
  return (id) => {
    const c = getChess(id);
    return ownDiyRecord(c, typeof priv === 'function' ? priv() : priv, typeof data === 'function' ? data() : data) || c;
  };
}

/** id → the 自选 record of a slot filled with `pick` (another player's unit), else the chess record. */
export function pickGetter(getChess, pick, data) {
  return (id) => {
    const c = getChess(id);
    return (isObj(pick) && c && c.isDiy ? diyRecordFor(c, pick, data) : null) || c;
  };
}

/** Whether a record is a composed 自选 record. */
export const isDiyRecord = (rec) => isObj(rec) && typeof rec.diyFor === 'string';

/**
 * The player's slotted 自选 pieces this match leaves out of the shop under the server's version-specific bond rule
 * (m.private.diyBanned — the server's initDiyStock: no stock), in slot order: [{ slotId, charId, name }] (the operator's
 * name from its composed record; the charId when the data lacks it). [] without any.
 * @param {any} priv m.private @param {(id: string) => any} getChess @param {{ chess?: any, backups?: any }} data
 */
export function diyBannedPieces(priv, getChess, data) {
  const ids = Array.isArray(priv?.diyBanned) ? priv.diyBanned.filter((id) => typeof id === 'string') : [];
  const picks = diyPicks(priv);
  const out = [];
  for (const slotId of ids) {
    const pick = picks[slotId];
    if (!isObj(pick) || typeof pick.charId !== 'string') continue;
    const chess = getChess(slotId);
    const rec = chess ? diyRecordFor(chess, pick, data) : null;
    out.push({ slotId, charId: pick.charId, name: rec?.name || pick.charId });
  }
  return out;
}
