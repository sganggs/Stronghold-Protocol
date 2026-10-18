// ui/gameLogic/shop.js — shop prices, merges, offers, the ready-funds prompt, the shop bar's fold on 准备. Re-exported from
// ../gameLogic.js.

import { GEO } from '../../../../shared/constants.js';
import { isObj } from './shared.js';
import { t, tName } from '../../../../shared/i18n.js';


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
  for (const p of pieces) if (p?.kind === 'chess' && !p.golden && (p.id === base || getChess(p.id)?.baseId === base) && !(getChess(p.id)?.isGolden ?? String(p.id).endsWith('_b'))) copies += 1;
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
    && !(getChess(p.id)?.isGolden ?? String(p.id).endsWith('_b')) && (p.id === base || getChess(p.id)?.baseId === base));
  if (!board.length) return null;
  board.sort((a, b) => a.col - b.col || b.row - a.row);
  return { row: board[0].row, col: board[0].col, dir: board[0].dir || 'RIGHT' };
}

/** Whether every hand slot is taken (the server refuses every purchase / reward pick then: HAND_FULL, GitHub #82). */
export function handFull(priv) {
  const hand = Array.isArray(priv?.hand) ? priv.hand : [];
  return hand.length >= GEO.HAND_SIZE && hand.every((p) => p != null);
}

/**
 * Would gaining one more `slot` (shop / reward card: { kind: 'chess'|'item', id }) complete a merge right away? Mirror
 * of server PlayerState completesChessMerge / completesItemMerge. (A full hand refuses such a purchase all the same:
 * PRTS 卫戍协议/帮助 §手牌区, GitHub #82.)
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
  // (the server names the offer by its source in Chinese: a strategy's effect, an item, an operator — a data name)
  const label = isObj(offer) && typeof offer.label === 'string' && offer.label ? tName(offer.label) : null;
  const queued = isObj(offer) && Number.isInteger(offer.queued) && offer.queued > 0 ? offer.queued : 0;
  const tail = { queued, more: queued ? t('之后还有 {queued} 项', { queued }) : null };
  if (!items && (!isObj(offer) || offer.source === 'merge' || offer.source == null) && !label) {
    return { title: t('晋升奖励'), micro: 'PROMOTION', sub: t('免费选择 1 名'), icon: 'crown', items: false, pill: t('晋升奖励待选择'), ...tail };
  }
  const title = label || (items ? t('装备补给') : t('特殊招募'));
  return { title, micro: 'SPECIAL', sub: items ? t('免费选择 1 件') : t('免费选择 1 名'), icon: 'refresh', items, pill: t('{title}待选择', { title }), ...tail };
}

/**
 * Why a shop action is unavailable (null when available).
 * @param {'buy'|'reward'|'refresh'|'freeze'|'levelUp'|'ready'} kind
 * @param {{ priv:any, editable:boolean, slot?:any }} ctx
 * @returns {string|null} Chinese reason
 */
export function shopBlockReason(kind, { priv, editable, slot } = {}) {
  if (!priv) return t('尚未就绪');
  if (priv.alive === false) return t('你已被淘汰');
  if (kind === 'ready') {
    if (priv.personalChoice) return t('请先完成教鞭选择');
    return priv.canReady === false ? t('临时整备区不为空，请先处理溢出的资源') : null;
  }
  if (!editable) {
    if (kind === 'reward') return t('当前无法选择');
    return priv.ready ? t('已准备就绪，取消准备后才能操作') : t('当前阶段无法进行该操作');
  }
  const funds = Number(priv.funds) || 0;
  const shop = priv.shop || {};
  if (kind === 'buy' || kind === 'reward') {
    if (!isObj(slot) || slot.sold) return kind === 'reward' ? t('已选择') : t('已售出');
    if ((Number(slot.price) || 0) > funds) return t('资金不足');
    // a full hand refuses every purchase / pick, a merge-completing one too (PRTS 卫戍协议/帮助 §手牌区, GitHub #82)
    if (handFull(priv)) return t('整备区已满');
    return null;
  }
  if (kind === 'refresh') return (Number(shop.refreshPrice) || 0) > funds ? t('资金不足') : null;
  if (kind === 'levelUp') {
    if ((Number(shop.level) || 1) >= (Number(shop.maxLevel) || 6)) return t('调度中心已达最高等级');
    return (Number(shop.upgradePrice) || 0) > funds ? t('资金不足') : null;
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
    title: t('剩余资金'), micro: 'FUNDS LEFT', okText: t('准备就绪'), cancelText: t('继续整备'),
    text: t('还有 {funds} 资金未使用。休整期结束时，本回合的剩余资金将清零。确定准备就绪吗？', { funds }),
  };
}

/**
 * The shop bar follows the player's ready state (GitHub #138, the owner's decision of 2026-10-07): pressing 准备就绪 folds
 * the bar — the board is set, the fight is what to look at —, cancelling it unfolds the bar again. Read from the own CONFIRMED
 * state (m.private.ready — a refused 准备 folds nothing) and only a change inside one prep counts: the first state seen (a
 * reconnect in the middle of a prep, the prep's start), the new round's reset to not ready and anything outside a prep are
 * not a press. The player can still fold / unfold by hand in between.
 * @param {{ round: any, ready: boolean }|null|undefined} prev the own prep state seen last (null: none — outside a prep)
 * @param {{ round: any, ready: boolean }|null|undefined} cur the own prep state now (null outside a prep)
 * @returns {'fold'|'unfold'|null}
 */
export function readyShopFold(prev, cur) {
  if (!isObj(prev) || !isObj(cur) || prev.round !== cur.round || !!prev.ready === !!cur.ready) return null;
  return cur.ready ? 'fold' : 'unfold';
}
