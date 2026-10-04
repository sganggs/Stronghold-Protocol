// Equip-replace dialog (research 04 §"Replacement" / 09 §1.2 UseEquipUp { charChessInstId, equipChessInstId,
// isChangeEquip, unloadInstId }; PRTS 帮助 "达到上限强行佩戴会改为替换装备"): an item dropped on an operator whose two
// equipment slots are used opens this dialog. It shows the operator, the incoming item and the two equipped items
// (icon, tier, name, effect); the player picks the one to replace — it is DESTROYED — and confirms: g.equip
// {itemUid, targetUid, replaceUid}. 取消 / ✕ / Esc / the backdrop change nothing (no intent is sent).
// Official look from the local ui/battle sprites (equip_replace_bg, _opiton_bg, _opition_select_01/02_bg, _arrow_line /
// _arrow_head, _avatart_bg / _frame, _round, _close, _comfirm_icon, _replace_icon), CSS look-alikes without them
// (css/screens/game-panels.css .eqr).
//
//   replaceRequest(ctx, intent, getChess, getItem) → { targetUid, targetId, targetName, item: {uid,id,name}, options }
//                                                 | null  (pure; the data the dialog shows — null = no dialog)
//   replaceIntent(intent, replaceUid)            → { t: 'g.equip', fields: { itemUid, targetUid, replaceUid } }
//   <EquipReplaceDialog request onConfirm(replaceUid) onCancel />

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, TierChip, MicroLabel } from './components.js';
import { UnitThumb, RichText, GIcon } from './gameComponents.js';
import { localAsset } from '../data.js';
import { T, TH } from '../i18n.js';
const cx = (...p) => p.flat().filter(Boolean).join(' ');
const isObj = (v) => !!v && typeof v === 'object';

/**
 * What the replace dialog shows for a g.equip drop intent that needs a replacement (`intent.confirmReplace`).
 * @param {{ pieces: Map<number, any> }} ctx placementContext
 * @param {{ t: string, fields: { itemUid: number, targetUid: number }, confirmReplace?: boolean }|null} intent gameLogic dropIntent
 * @param {(id: string) => any} [getChess]
 * @param {(id: string) => any} [getItem]
 */
export function replaceRequest(ctx, intent, getChess = () => null, getItem = () => null) {
  if (!intent || intent.t !== 'g.equip' || !intent.confirmReplace || !isObj(intent.fields)) return null;
  const target = ctx?.pieces?.get(intent.fields.targetUid)?.piece;
  const item = ctx?.pieces?.get(intent.fields.itemUid)?.piece;
  if (!isObj(target) || target.kind !== 'chess' || !isObj(item) || item.kind !== 'item') return null;
  const equipped = (Array.isArray(target.items) ? target.items : []).filter((it) => isObj(it) && Number.isInteger(it.uid));
  if (equipped.length < 2) return null;
  const rec = (id) => getItem(id) || null;
  return {
    targetUid: target.uid,
    targetId: target.id,
    targetName: getChess(target.id)?.name || T('该干员'),
    golden: !!target.golden,
    item: { uid: item.uid, id: item.id, name: rec(item.id)?.name || T('装备') },
    options: equipped.map((it) => ({ uid: it.uid, id: it.id, name: rec(it.id)?.name || it.id })),
  };
}

/**
 * The g.equip intent that replaces `replaceUid` (one of the target's equipped items, or the intent is unchanged).
 * @param {{ t: string, fields: { itemUid: number, targetUid: number } }} intent
 * @param {number} replaceUid
 */
export function replaceIntent(intent, replaceUid) {
  const f = intent?.fields || {};
  const fields = { itemUid: f.itemUid, targetUid: f.targetUid };
  if (Number.isInteger(replaceUid)) fields.replaceUid = replaceUid;
  return { t: 'g.equip', fields };
}

/** One official sprite as a CSS custom property (empty when the local-client art is not installed). */
const spriteVar = (name, sprite) => {
  const url = localAsset('ui/battle', sprite);
  return url ? `${name}:url("${url}");` : '';
};

/** An item card of the dialog (the incoming item on top, the two equipped options below). */
function ItemCard({ id, item, rec, selected = false, option = false, onPick }) {
  const tier = rec?.tier;
  const body = html`
    <span class="eqr__icon">
      <${UnitThumb} kind="item" id=${id} size="md" showTier=${false} />
    </span>
    <span class="eqr__meta">
      <span class="eqr__chips">${tier ? html`<${TierChip} tier=${tier} golden=${!!rec?.isGolden} size="sm" />` : null}
        ${rec?.isGolden ? html`<span class="eqr__elite">${T('进阶')}</span>` : null}</span>
      <b class="eqr__name">${rec?.name || item?.name || id}</b>
    </span>
    <${RichText} as="p" class="eqr__desc" text=${rec?.descRaw || rec?.desc || ''} />`;
  if (!option) return html`<div class="eqr__card eqr__card--new">${body}</div>`;
  return html`<button type="button" role="radio" aria-checked=${selected ? 'true' : 'false'} data-uid=${item.uid}
      class=${cx('eqr__card', 'eqr__opt', selected && 'is-sel')} onClick=${() => onPick(item.uid)}>
    ${body}
    <span class="eqr__flag" aria-hidden=${selected ? 'false' : 'true'}>
      <${GIcon} name="trash" class="eqr__flag-icon" /><span>${T('将被销毁')}</span>
    </span>
  </button>`;
}

/**
 * The dialog.
 * @param {{ request: ReturnType<typeof replaceRequest>, getItem?: (id: string) => any, busy?: boolean,
 *   onConfirm: (replaceUid: number) => void, onCancel: () => void }} props
 */
export function EquipReplaceDialog({ request, getItem = () => null, busy = false, onConfirm, onCancel }) {
  const [sel, setSel] = useState(null);
  const key = request ? `${request.targetUid}:${request.item.uid}` : '';
  useEffect(() => { setSel(null); }, [key]);
  if (!request) return null;
  const chosen = request.options.find((o) => o.uid === sel) || null;
  const style = [
    spriteVar('--eqr-bg', 'equip_replace_bg'), spriteVar('--eqr-opt', 'equip_replace_opiton_bg'),
    spriteVar('--eqr-sel', 'equip_replace_opition_select_02_bg'), spriteVar('--eqr-selbar', 'equip_replace_opition_select_01_bg'),
    spriteVar('--eqr-round', 'equip_replace_round'), spriteVar('--eqr-ava', 'equip_replace_avatart_bg'),
    spriteVar('--eqr-avaf', 'equip_replace_avatart_frame'), spriteVar('--eqr-aline', 'equip_replace_arrow_line'),
    spriteVar('--eqr-ahead', 'equip_replace_arrow_head'),
  ].join('');
  const confirmIcon = localAsset('ui/battle', 'equip_replace_comfirm_icon');
  const swapIcon = localAsset('ui/battle', 'equip_replace_replace_icon');
  return html`<div class="eqr-host" style=${style} onKeyDown=${(e) => { if (e.key === 'Enter' && chosen && !busy) { e.preventDefault(); onConfirm(chosen.uid); } }}>
    <${Modal} open=${true} tone="red" class="eqr" width="min(7.6rem, 96vw)" micro="EQUIPMENT · REPLACE" title=${T('替换装备')} onClose=${onCancel}
      actions=${html`
        <${Button} variant="secondary" icon="close" class="eqr__cancel" onClick=${onCancel}>${T('取消')}<//>
        <${Button} variant="danger" class="eqr__ok" disabled=${!chosen} loading=${busy} data-autofocus onClick=${() => chosen && onConfirm(chosen.uid)}>
          ${TH('{0}确认替换', confirmIcon ? html`<img class="eqr__ok-icon" src=${confirmIcon} alt="" draggable=${false} />` : null)}<//>`}>
      <p class="eqr__lead">${TH('「{0}」的装备栏已满（2/2）。选择一件装备进行替换，{1}。', html`<b>${request.targetName}</b>`, html`<b class="t-red">${T('被替换的装备将被销毁')}</b>`)}</p>
      <div class="eqr__top">
        <div class="eqr__op" title=${request.targetName}>
          <span class="eqr__ava"><${UnitThumb} kind="chess" id=${request.targetId} golden=${request.golden} size="md" /></span>
          <span class="eqr__opname">${request.targetName}</span>
        </div>
        <span class="eqr__swap" aria-hidden="true">${swapIcon ? html`<img src=${swapIcon} alt="" draggable=${false} />` : html`<${GIcon} name="refresh" />`}</span>
        <div class="eqr__incoming">
          <${MicroLabel} tone="mint">${T('新装备')}</${MicroLabel}>
          <${ItemCard} id=${request.item.id} item=${request.item} rec=${getItem(request.item.id)} />
        </div>
      </div>
      <div class="eqr__arrow" aria-hidden="true"><i class="eqr__aline"></i><i class="eqr__ahead eqr__ahead--l"></i><i class="eqr__ahead eqr__ahead--r"></i></div>
      <div class="eqr__opts" role="radiogroup" aria-label=${T('选择被替换的装备')}>
        ${request.options.map((o) => html`<${ItemCard} key=${o.uid} id=${o.id} item=${o} rec=${getItem(o.id)} option=${true}
          selected=${o.uid === sel} onPick=${(uid) => setSel((s) => (s === uid ? null : uid))} />`)}
      </div>
      <p class="eqr__hint">${chosen ? html`${T('将销毁「')}<b>${chosen.name}</b>${T('」并配发「')}<b>${request.item.name}</b>]` : T('点击选择要替换的装备')}</p>
    <//>
  </div>`;
}
