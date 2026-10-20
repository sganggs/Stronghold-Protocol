// 名片干员 (PR #643 split 6): the portrait on a doctor's seat card in the waiting room (screens/room.js) — the operator
// the player picked (room.card; everybody sees it as room.state seats[].card), else one of the 5★/6★ operators chosen
// by the player id, the same on every client. Pure: the screen passes the chess records (ui/assetUrls.js
// chessPortraitUrl turns the operator into its portrait; without the art pack the card keeps its avatar frame).

/** 名片干员: the player's own pick (a localStorage pref, sent as room.card). */
export const CARD_PREF = 'room.card';

/** FNV-1a of a string (the default portrait: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The operators a seat card can show — the server's room.card whitelist (server/lobby.js chessCharIds): one record per
 * charId of the visible, non-自选 chess records (the elite form, for its E2 art), 6★ first, then by name.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!c || c.isDiy || c.visible === false || typeof c.charId !== 'string') continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * What the seat cards draw from: the pickable operators by charId and the default pool (5★/6★, by charId so every
 * client orders it the same).
 * @param {any[]} list cardOperators()
 */
export function cardContext(list) {
  return {
    byChar: new Map(list.map((c) => [c.charId, c])),
    pool: list.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : a.charId > b.charId ? 1 : 0)),
  };
}

/**
 * The operator on a seat card: the player's pick (one's own seat shows the local pick at once, the others the server's
 * seats[].card), else one of the pool chosen by the player id. null for an empty seat, a bot, or before the data loads.
 * @param {any} seat room.state seat
 * @param {{ byChar: Map<string, any>, pool: any[] }} ctx cardContext()
 * @param {{ myId?: any, myCard?: string }} [own]
 * @returns {{ chess: any, picked: boolean } | null}
 */
export function seatOperator(seat, { byChar, pool }, { myId, myCard } = {}) {
  if (!seat || seat.playerId == null || seat.isBot) return null;
  const pick = (seat.playerId === myId ? myCard : seat.card) || '';
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) return { chess: rec, picked: true };
  if (!Array.isArray(pool) || !pool.length) return null;
  return { chess: pool[hash32(seat.playerId) % pool.length], picked: false };
}
