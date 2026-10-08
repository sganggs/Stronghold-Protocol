// Whose bonds the bond strip shows (DESIGN §20.15, user report after playtest #6: "观看队友时…盟约栏应该变成当前队友的
// 盟约以及他的层数") — pure helpers for the game screen (screens/game.js), the strip and its popup (ui/bondStrip.js).
//
// The strip follows the player whose field / half the camera shows:
//   * the own board (prep) and the own battle → your own bonds (m.private bonds);
//   * a teammate's board in prep (前往查看, research 09 §3.1 "their board, read-only, including their pen and bonds"), a
//     teammate's battle watched after the own one ended, the field an eliminated player auto-observes → THAT player's
//     bonds (m.public players[].bonds);
//   * a shared field (联防 'u', the Final Assault / Hidden Core pair 'b1' / 'b2') — no source shows the strip there; this
//     rule was settled by the user (DESIGN §20.15): the player holding the half the ‹ › pill points at ("你自己" → yours, "👁 name" → theirs). On 全景 (or an
//     empty half, "无人在家"): yourself when you fight on that field; a viewer who does not (a 联防 leaker, an eliminated
//     spectator) never sees their own bonds there — the teammate they picked with 前往查看 (official observing targets a
//     player: ObserveUp / DeadAutoObDn { obIndex }), else the field's first player (helper 1 / the pair's first seat;
//     the official non-helper pill reads "‹ 👁 helper# ›"). 前往查看 of a player on a two-half field also moves the
//     camera to their half (playerLayer), so the pill and the strip name the same player.
// In battle the layers are live: the local simulation of the battle on screen (the own one, a teammate's display
// replica — battle/runner.js state().bondLayers, absolute counts ≤ BOND_LAYER_CAP) is laid over the view's start-of-
// round counts; the server's views add the finished normal battle's gains from the end of COMBAT until the settlement
// (server/match/bondsMeta.js bondsWithGains), so the counts never fall back during 联防.
// A detail card's bond chips follow the UNIT's owner instead (detailBondOwner: a shared field shows both halves' units
// whoever the strip follows), and a bond popup carries the player it was opened for (toggleBond / popupView): the
// strip's owner, or the chip's — its entry, member list and "👁 name" label always belong to that one player.

import { BOND_LAYER_CAP } from '../../../shared/constants.js';
import { sidesOf, nameOf, cameraLayers } from '../battle/observe.js';

const isObj = (v) => !!v && typeof v === 'object';
const playersOf = (pub) => (Array.isArray(pub?.players) ? pub.players.filter(isObj) : []);
const fieldsOf = (pub) => (Array.isArray(pub?.fields) ? pub.fields.filter(isObj) : []);

/**
 * The field on screen whose player the strip follows; null = the own prep board.
 * @param {{ combat?: boolean, settle?: boolean, watchingOther?: boolean, watching?: string|null,
 *   battleFieldId?: string|null, home?: string|null }} o — battleFieldId: the battle the view shows (client-side combat:
 *   the runner's battle on screen, which is also the field an eliminated player auto-observes; server-run combat: the
 *   field the view entered)
 * @returns {string|null}
 */
export function screenFieldId({ combat = false, settle = false, watchingOther = false, watching = null, battleFieldId = null, home = null } = {}) {
  if (watchingOther && typeof watching === 'string' && watching) return watching;
  if (!combat && !settle) return null;
  if (typeof battleFieldId === 'string' && battleFieldId) return battleFieldId;
  return typeof home === 'string' && home ? home : null;
}

/**
 * The player whose bonds the strip shows (see the header).
 * @param {{ pub: any, myId: string, fieldId?: string|null, field?: any, layer?: 'L'|'ALL'|'R', halves?: boolean,
 *   watched?: string|null }} o — field: the field meta on screen (store.match.field: `sides` / `players`), consulted when
 *   it is `fieldId`; halves: the ‹ › pill is offered (battle/observe.js cameraLayers non-empty); watched: the player
 *   picked with 前往查看 (watchedPlayer), consulted on a shared field the viewer does not fight on
 * @returns {string}
 */
export function bondOwnerId({ pub, myId, fieldId = null, field = null, layer = 'ALL', halves = false, watched = null } = {}) {
  const known = new Set(playersOf(pub).map((p) => p.playerId));
  const ok = (pid) => typeof pid === 'string' && pid !== '' && known.has(pid);
  if (typeof fieldId !== 'string' || !fieldId) return myId;
  // a normal field / a prep board: 'n:<playerId>' (DESIGN §8.3)
  if (fieldId.startsWith('n:')) {
    const pid = fieldId.slice(2);
    return ok(pid) ? pid : myId;
  }
  const meta = isObj(field) && field.fieldId === fieldId ? field : null;
  const sides = meta ? sidesOf(meta) : {};
  if (halves && meta && (layer === 'L' || layer === 'R')) {
    const pid = Object.keys(sides).find((id) => sides[id] === layer);
    if (ok(pid)) return pid;
  }
  // 全景, an empty half, no ‹ › pill: the field's members (m.public.fields, else the meta)
  const listed = fieldsOf(pub).find((f) => f.fieldId === fieldId);
  const members = Array.isArray(listed?.players) ? listed.players : Array.isArray(meta?.players) ? meta.players : [];
  if (members.includes(myId)) return myId;
  // not on that field (a 联防 leaker, an eliminated spectator): never your own — the picked teammate, else the first
  if (ok(watched) && members.includes(watched)) return watched;
  const first = members.find(ok);
  return first || myId;
}

/**
 * The player picked with 前往查看 while that watch is on screen: `who` = { fieldId, playerId } remembered by the game
 * screen when a team row was tapped (a shared field shows more than one player, the fieldId alone cannot tell).
 * @param {{ fieldId?: string, playerId?: string }|null} who @param {string|null} watching the watched fieldId
 * @returns {string|null}
 */
export function watchedPlayer(who, watching) {
  if (!isObj(who) || typeof who.playerId !== 'string' || !who.playerId) return null;
  return typeof watching === 'string' && watching && who.fieldId === watching ? who.playerId : null;
}

/**
 * The ‹ › layer that shows `playerId`'s half of a two-half shared field (联防 with two helpers, a pair's boss field),
 * or null (a normal / lone field, a player not on it). 前往查看 of such a player moves the camera there.
 * @param {any} field the field meta on screen @param {any} pub @param {string} myId @param {string|null} playerId
 * @returns {'L'|'R'|null}
 */
export function playerLayer(field, pub, myId, playerId) {
  if (!isObj(field) || typeof playerId !== 'string' || !playerId) return null;
  if (!cameraLayers(field, pub, myId).length) return null;
  const side = sidesOf(field)[playerId];
  return side === 'L' || side === 'R' ? side : null;
}

/**
 * A player's bond list as the views carry it: your own m.private bonds (thresholds / countsHand included), a teammate's
 * m.public players[].bonds ({ bondId, count, active, tier, layers, harmony? } — `harmony`: 调和's +1 is in `count`, the
 * popup's 调和 row; DESIGN §21.26).
 * @returns {any[]}
 */
export function ownerBonds({ pub, priv = null, myId, ownerId }) {
  const row = (pid) => playersOf(pub).find((p) => p.playerId === pid) || null;
  if (ownerId === myId) {
    if (Array.isArray(priv?.bonds)) return priv.bonds;
    const own = row(myId)?.bonds;
    return Array.isArray(own) ? own : [];
  }
  const list = row(ownerId)?.bonds;
  return Array.isArray(list) ? list : [];
}

/**
 * Lay the live layers of the battle on screen over a bond list: `live` = { [bondId]: n } absolute counts (the runner's
 * bondLayers of that player). A count only ever grows in a battle — the higher of the two wins (the view may already
 * carry the settled gains) — and never shows above BOND_LAYER_CAP; a bond that gained without being listed joins the
 * list (no members, not active). Returns the list itself when there is nothing to lay over.
 * @param {any[]} bonds @param {Record<string, number>|null|undefined} live
 */
export function withLiveLayers(bonds, live) {
  const list = Array.isArray(bonds) ? bonds : [];
  if (!isObj(live)) return list;
  const cap = BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity;
  const ids = Object.keys(live).filter((id) => Number.isFinite(live[id]) && live[id] > 0);
  if (!ids.length) return list;
  let changed = false;
  const out = list.map((b) => {
    const n = isObj(b) && typeof b.bondId === 'string' ? live[b.bondId] : undefined;
    if (!Number.isFinite(n)) return b;
    const v = Math.min(cap, n);
    if (!(v > (Number(b.layers) || 0))) return b;
    changed = true;
    return { ...b, layers: v };
  });
  for (const id of ids) {
    if (out.some((b) => isObj(b) && b.bondId === id)) continue;
    changed = true;
    out.push({ bondId: id, count: 0, active: false, tier: 0, layers: Math.min(cap, live[id]) });
  }
  return changed ? out : list;
}

/**
 * A teammate's board as far as the screen shows it, in the m.private shape the bond popup's member list reads
 * (gameLogic bondMembers): their deployed operators on the field meta on screen (a prep scout's `area: 'board'`, or a
 * server-run battle's units) and, under client-side combat, the battle on screen's (`extra` = battle/runner.js
 * ownerOps: the meta the runner publishes is taken before the operators deploy). A prep scout's hand / temp operators
 * remain visible on the field but do not enter this board. Their operators keep the items the unit info carries
 * (UnitInfo `items`), so a 变形同构体
 * wearer is listed as a member of the bond it grants (gameLogic grantedBonds), and a 补位 unit its `standInFor` (the
 * popup draws the stand-in). null without a field or battle.
 * @param {any} field @param {string} ownerId @param {any[]|null} [extra] UnitInfo-like { kind, ownerId, defId, items?, standInFor? }
 */
export function ownerBoard(field, ownerId, extra = null) {
  const fromField = isObj(field) && Array.isArray(field.units) ? field.units : null;
  const fromBattle = Array.isArray(extra) ? extra : null;
  if (!fromField && !fromBattle) return null;
  const board = [...(fromField || []), ...(fromBattle || [])]
    .filter((u) => isObj(u) && u.ownerId === ownerId && u.kind === 'op' && typeof u.defId === 'string'
      && u.area !== 'hand' && u.area !== 'temp')
    .map((u) => {
      const p = Array.isArray(u.items) && u.items.length ? { kind: 'chess', id: u.defId, items: u.items.filter((x) => typeof x === 'string') } : { kind: 'chess', id: u.defId };
      // 0.2.0 自选编队: a DIY slot's unit names its operator (UnitInfo diy) — the popup counts it for that operator's bonds
      if (isObj(u.diy) && typeof u.diy.charId === 'string') p.diy = u.diy;
      // 0.2.0 补位: a unit fighting as its stand-in says so (UnitInfo standInFor) — the popup draws that member as the stand-in
      if (typeof u.standInFor === 'string' && u.standInFor) p.standInFor = u.standInFor;
      return p;
    });
  return { board, hand: [], temp: [] };
}

/**
 * Everything the strip needs: whose bonds, their name (null for your own) and the list with the live layers laid over.
 * @param {{ pub: any, priv?: any, myId: string, fieldId?: string|null, field?: any, layer?: 'L'|'ALL'|'R', halves?: boolean,
 *   watched?: string|null, live?: Record<string, Record<string, number>>|null }} o — live: the runner's bondLayers (null
 *   outside a battle)
 * @returns {{ ownerId: string, self: boolean, name: string|null, bonds: any[] }}
 */
export function stripView({ pub, priv = null, myId, fieldId = null, field = null, layer = 'ALL', halves = false, watched = null, live = null }) {
  const ownerId = bondOwnerId({ pub, myId, fieldId, field, layer, halves, watched });
  const self = ownerId === myId;
  const bonds = withLiveLayers(ownerBonds({ pub, priv, myId, ownerId }), isObj(live) ? live[ownerId] : null);
  return { ownerId, self, name: self ? null : nameOf(pub, ownerId), bonds };
}

/**
 * The game screen's strip from its state (screens/game.js): the field on screen, whether the ‹ › pill is offered for
 * it, the picked teammate, the live layers (battle phases and SETTLE only) — then stripView. Also returns `fieldId`.
 * @param {{ pub: any, priv?: any, myId: string, combat?: boolean, settle?: boolean, watchingOther?: boolean,
 *   watching?: string|null, home?: string|null, battleFieldId?: string|null, field?: any, layers?: any[],
 *   layer?: 'L'|'ALL'|'R', who?: { fieldId?: string, playerId?: string }|null,
 *   bondLayers?: Record<string, Record<string, number>>|null }} o — layers: the ‹ › pill's layers on offer
 *   (battle/observe.js cameraLayers of `field`, [] when not offered); bondLayers: the runner's state().bondLayers
 * @returns {{ fieldId: string|null, ownerId: string, self: boolean, name: string|null, bonds: any[] }}
 */
export function screenStrip({ pub, priv = null, myId, combat = false, settle = false, watchingOther = false, watching = null, home = null,
  battleFieldId = null, field = null, layers = [], layer = 'ALL', who = null, bondLayers = null }) {
  const fieldId = screenFieldId({ combat, settle, watchingOther, watching, home, battleFieldId });
  const halves = Array.isArray(layers) && layers.length > 0 && isObj(field) && field.fieldId === fieldId;
  const live = (combat || settle) && isObj(bondLayers) ? bondLayers : null;
  const watched = watchingOther ? watchedPlayer(who, watching) : null;
  return { fieldId, ...stripView({ pub, priv, myId, fieldId, field, layer, halves, watched, live }) };
}

/**
 * The bonds of any player with the live layers laid over (the detail card's bond chips of a teammate's unit).
 * @param {{ pub: any, priv?: any, myId: string, ownerId: string, live?: Record<string, Record<string, number>>|null }} o
 */
export function playerBonds({ pub, priv = null, myId, ownerId, live = null }) {
  return withLiveLayers(ownerBonds({ pub, priv, myId, ownerId }), isObj(live) ? live[ownerId] : null);
}

/**
 * Whose bonds a detail card's bond chips show — and so the popup a chip opens: a unit on the field → its owner (yours or
 * a teammate's, when a known player: a 联防 / 最终攻势 field shows both halves' units whoever the strip follows); your own
 * piece (board / bench) → yours; a bond-member card opened from a popup → that popup's owner (`target.owner`); anything
 * else (shop / reward / drawer cards, a unit without a known owner) → the strip's owner.
 * @param {any} target the detail target (screens/game.js detailTarget) @param {{ pub: any, myId: string,
 *   stripOwnerId?: string|null }} o
 * @returns {string}
 */
export function detailBondOwner(target, { pub, myId, stripOwnerId = null }) {
  const known = (pid) => typeof pid === 'string' && pid !== '' && playersOf(pub).some((p) => p.playerId === pid);
  if (isObj(target)) {
    if (target.kind === 'unit' && known(target.unit?.ownerId)) return target.unit.ownerId;
    if (target.kind === 'piece') return myId;
    if (target.kind === 'chess' && known(target.owner)) return target.owner;
  }
  return typeof stripOwnerId === 'string' && stripOwnerId ? stripOwnerId : myId;
}

/**
 * Open / close a bond popup: `open` = { id, ownerId, from } — the bond, the player it shows (the strip's owner, or the
 * detail card's: detailBondOwner) and where it was opened ('strip' | 'detail'). The same bond of the same player closes it.
 * @param {{ id: string, ownerId: string, from?: string }|null} open @param {string} id @param {string} ownerId
 * @param {'strip'|'detail'} from
 */
export function toggleBond(open, id, ownerId, from) {
  if (isObj(open) && open.id === id && open.ownerId === ownerId) return null;
  return { id, ownerId, from };
}

/**
 * The bond popup's data, for the player it was opened for (never simply the strip's: a chip of the other half's unit
 * opens THAT player's bond): their entry with the live layers (as the strip and the chips show it), the member list's
 * board (your pieces, or their operators on the field on screen — ownerBoard) and their name (null for your own).
 * @param {{ open: { id: string, ownerId?: string }|null, pub: any, priv?: any, myId: string, field?: any,
 *   units?: any[]|null, live?: Record<string, Record<string, number>>|null }} o — units: the owner's operators in the
 *   battle on screen (battle/runner.js ownerOps; null outside client-side combat); live: the runner's bondLayers (null
 *   outside a battle)
 * @returns {{ bondId: string, ownerId: string, self: boolean, name: string|null, entry: any, priv: any }|null}
 */
export function popupView({ open, pub, priv = null, myId, field = null, units = null, live = null }) {
  if (!isObj(open) || typeof open.id !== 'string' || !open.id) return null;
  const ownerId = typeof open.ownerId === 'string' && open.ownerId ? open.ownerId : myId;
  const self = ownerId === myId;
  const entry = playerBonds({ pub, priv, myId, ownerId, live }).find((b) => isObj(b) && b.bondId === open.id) || null;
  return { bondId: open.id, ownerId, self, name: self ? null : nameOf(pub, ownerId), entry, priv: self ? priv : ownerBoard(field, ownerId, units) };
}
