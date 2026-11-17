// ui/gameLogic/draft.js — 机变 and band-draft normalisation. Re-exported from ../gameLogic.js.

import { isObj } from './shared.js';
import { PHASE } from '../../../../shared/constants.js';
import { t } from '../../../../shared/i18n.js';


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
 * The draft as it ended, for the draft screen screens/game.js keeps on 已选定策略 a moment after BAND_DRAFT (PR #643):
 * the last BAND_DRAFT snapshot with every pick filled in from the players' `bandId` (the pick that ended the draft
 * arrives with the next phase, when m.public.draft is gone) and no turn or countdown left.
 * @param {any} last the last public state of BAND_DRAFT
 * @param {any} pub the public state now
 */
export function heldDraftPub(last, pub) {
  const players = Array.isArray(pub?.players) ? pub.players : last.players;
  const picks = { ...(last.draft?.picks || {}) };
  for (const p of Array.isArray(players) ? players : []) if (p && p.bandId && !picks[p.playerId]) picks[p.playerId] = p.bandId;
  return { ...last, players, deadline: 0, draft: { ...last.draft, picks, turn: null, turnDeadline: 0 } };
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

/** Adapt only the recipient's current PREP choice; never write it into the public draft. */
export function normalizePersonalChoice(pub, priv, myId) {
  const choice = priv?.personalChoice;
  if (pub?.phase !== PHASE.PREP || !priv || priv.playerId !== myId || priv.alive === false
    || !choice || choice.round !== pub.round) return null;
  return {
    ...normalizeSp({ family: 'bounty', name: t('教鞭 · 战术特训'), desc: t('请选择一项战术特训'),
      cards: choice.cards, turn: myId, order: [myId], picks: {} }),
    id: choice.id,
  };
}
