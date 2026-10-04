// Bottom shop bar (research 06 §11.2 / D3): LEVEL card (upgrade price hex, 升级), 3–5 operator cards
// (tier chip, price hex with discount/markup colours, portrait, bonds — a bond the mode never activates struck through,
// 本局禁用 — class, frozen overlay, sold state,
// merge progress), the item card, the funds card with ✕ 收起; above it 剩余可放置角色, 冻结/解冻 and 刷新.
// Buying and upgrading take two taps (research 09 §5 / §6.5, official `EventOnFirstClick` → `EventOnConfirm` /
// `EventOnUpgrade`): the first tap selects a card — it lifts and enlarges, its detail opens and it shows 确认购买
// (无法购买 + the reason when it cannot be bought) — and a second tap on the same card buys it; the LEVEL card's first
// tap arms 确认升级 and the second upgrades (已满级 at level 6). A tap anywhere else, a shop change or the end of the
// editable phase disarms. A tap anywhere on a card is the card's tap — its 确认购买 strip included (it takes no
// pointer): there is no ⓘ corner (the official cards have none; user playtest #6 item 10 — on phones its invisible
// 44 px touch area covered the card's bottom-right quarter, half the strip, and a second tap there only re-opened the
// detail); a card that cannot be bought right now (the bar is not editable: ready, round start) opens its detail. The
// D / R / F keys stay one-press shortcuts. There is no drag-to-sell zone: selling is the 出售 +N button of a tapped
// unit's underframe (ui/underframe.js). After a promotion the operator cards are replaced by
// the 晋升奖励 cards (3 free operators, pick 1 — also two taps) until picked or put off (稍后 → rewardOverlay.js pill);
// a special refresh (凯瑟琳 定向投放's 3 items, 娜仁图亚, 寻呼模块, 信标, 松果) takes the same place under its own name, an
// item slot drawn as an item card (player report #6 after 0.1.0).
// Every operator card shows the skill it will fight with — the player's 干员调配 loadout (m.private.loadout, DESIGN
// §16): the skill icon above the name, mint-framed with 已调配 in its title when it is not the default skill (and the
// module type of an elite card, with its official type icon when the local-client art has it).

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, HexBadge, TierChip, Tooltip, MicroLabel } from './components.js';
import { Img, BondGlyph, CoinGlyph, GIcon, RichText } from './gameComponents.js';
import { priceTone, mergeProgress, mergeTarget, shopBlockReason, chessLoadout, offerHeader, briefingBondTip } from './gameLogic.js';
import { chessPortraitUrl, itemIconUrl, profIconUrl, uiUrl, skillIconUrl, skillRecordIconUrl, moduleTypeIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { T, TH } from '../i18n.js';
const cx = (...p) => p.flat().filter(Boolean).join(' ');

function PriceHex({ slot, free, poor = false }) {
  const tone = priceTone(slot);
  const price = Number(slot?.price) || 0;
  if (free || price === 0) return html`<span class="scard__free">FREE</span>`;
  // like the original (img_bg_price_not_enough) the price turns grey while the funds don't cover it
  return html`<${HexBadge} value=${price} tone=${poor ? 'dark' : tone} size="md" class=${cx('scard__price', poor && 'is-poor')}
    title=${poor ? T('资金不足') : tone === 'discount' ? T('折扣价（原价 {0}）', slot.basePrice) : tone === 'premium' ? T('加价（原价 {0}）', slot.basePrice) : T('价格')} />`;
}

/** Data lookups for shopBlockReason (full-hand purchases that complete a merge stay allowed). */
const LOOKUPS = { getChess: (id) => data.lookup('chess', id), getItem: (id) => data.lookup('items', id) };

/**
 * Where a merge-completing buy sends the elite (DESIGN §20.11), null when the card completes no merge: the 可晋升 tag's
 * title, and a line of the detail card the first tap opens — a touch screen never shows a title (QA 6b).
 */
export function mergeHint(priv, chessId) {
  const prog = mergeProgress(priv, chessId, LOOKUPS.getChess);
  if (!(prog.copies > 0 && prog.copies + 1 >= prog.need)) return null;
  return mergeTarget(priv, chessId, LOOKUPS.getChess) ? T('精锐干员将出现在作战区原位置') : T('精锐干员将进入整备区');
}

/** The armed (first-tapped) card's confirm strip: 确认购买 / 确认选择, or 无法购买 + why. */
function ArmedTag({ reason, free }) {
  if (reason) return html`<span class="scard__confirm is-no" role="status"><b>${T('无法购买')}</b><small>${reason}</small></span>`;
  return html`<span class="scard__confirm" role="status"><b>${free ? T('确认选择') : T('确认购买')}</b><small>${T('再次点击')}</small></span>`;
}

/**
 * Operator card (shop and merge reward). `armed`: first tap done (second tap = `onBuy(idx)`).
 * @param {{ slot:any, idx:number, priv:any, frozen?:boolean, reason?:string|null, free?:boolean, armed?:boolean,
 *   onTap?:(idx:number)=>void, onBuy:Function, onDetail:Function }} props
 */
export function ChessCard({ slot, idx, priv, frozen = false, reason = null, free = false, armed = false, onTap = null, onBuy, onDetail, offBonds = null }) {
  const c = data.lookup('chess', slot.id);
  const m = data.get('assets');
  const tier = c?.tier ?? 1;
  const prog = mergeProgress(priv, slot.id, (id) => data.lookup('chess', id));
  const hint = mergeHint(priv, slot.id);
  const willMerge = !!hint;
  const bonds = Array.isArray(c?.bonds) ? c.bonds : [];
  const disabled = !!reason;
  const lo = c ? chessLoadout(c, priv?.loadout, LOOKUPS.getChess) : null;
  const tap = () => { if (onTap) onTap(idx); else if (!disabled) onBuy(idx); else onDetail(slot.id, 'chess', hint); };
  const card = html`<button type="button" class=${cx('scard', `scard--t${tier}`, frozen && 'is-frozen', disabled && 'is-disabled', willMerge && 'is-merge', armed && 'is-armed')}
      onClick=${tap} onContextMenu=${(e) => { e.preventDefault(); onDetail(slot.id, 'chess', hint); }}
      aria-label=${T('{0}，价格 {1}{2}', c?.name || T('干员'), slot.price, armed ? (disabled ? T('，无法购买') : T('，再次点击确认')) : '')} aria-pressed=${onTap ? String(!!armed) : undefined}>
    <span class="scard__bg" aria-hidden="true"></span>
    <span class="scard__water" aria-hidden="true">${bonds[0] ? html`<${BondGlyph} bondId=${bonds[0]} />` : null}</span>
    <${Img} src=${chessPortraitUrl(m, c)} class="scard__art" />
    <span class="scard__top">
      <${TierChip} tier=${tier} size="md" />
      <${PriceHex} slot=${slot} free=${free} poor=${reason === T('资金不足')} />
      ${prog.copies > 0 ? html`<span class="scard__pips" title=${T('已拥有 {0}/{1}', prog.copies, prog.need)}>
        ${Array.from({ length: prog.need }, (_, i) => html`<i key=${i} class=${i < prog.copies ? 'on' : ''}></i>`)}
      </span>` : null}
    </span>
    <span class="scard__body">
      ${lo?.skill ? html`<${SkillBadge} chess=${c} lo=${lo} />` : null}
      <span class="scard__name">${c?.name || slot.id}</span>
      <span class="scard__bonds">
        ${bonds.slice(0, 3).map((b) => {
          const name = data.lookup('bonds', b)?.name || b;
          const off = !!(offBonds && offBonds.has(b)); // a bond this mode never activates (gameLogic modeOffBonds)
          return html`<span key=${b} class=${cx('scard__bond', off && 'is-off')} title=${off ? briefingBondTip(name, 'off') : undefined}><${BondGlyph} bondId=${b} /><span>${name}</span></span>`;
        })}
      </span>
      <span class="scard__class">
        <${Img} src=${profIconUrl(m, c?.profession)} class="scard__prof" />
        <span>${c?.subProfessionName || ''}</span>
      </span>
    </span>
    ${willMerge ? html`<span class="scard__mergetag" title=${hint}>${T('可晋升')}</span>` : null}
    ${frozen ? html`<span class="scard__ice" aria-hidden="true"><${Icon} name="snow" /></span>` : null}
    ${armed ? html`<${ArmedTag} reason=${reason} free=${free} />` : null}
  </button>`;
  return reason && reason !== T('已售出') && !armed ? html`<${Tooltip} text=${reason} block=${true} class="scard-wrap">${card}<//>` : card;
}

/** The loadout's skill (icon; name + 已调配 in the tooltip) and an elite's module type, on an operator card. */
function SkillBadge({ chess, lo }) {
  const m = data.get('assets');
  const custom = !lo.defaultSkill;
  // a chosen skill without an icon in the manifest: its slot letter (S1–S3) instead of the blank skill sprite
  const src = custom ? skillRecordIconUrl(m, lo.skill, { empty: false }) : skillIconUrl(m, chess);
  const slot = Number.isInteger(lo.skill.index) ? `S${lo.skill.index + 1}` : null;
  const mod = lo.module && !lo.module.none ? lo.module : null;
  const tip = T('技能{0}：{1}{2}{3}', slot ? ` ${slot}` : '', lo.skill.name || '', custom ? T('（已调配）') : '', mod ? T(' · 模组：{0}', mod.name) : lo.module?.none ? T(' · 未装备模组') : '');
  return html`<span class=${cx('scard__skill', custom && 'is-custom')} title=${tip} aria-label=${tip} data-skill=${lo.skill.skillId || ''}>
    <${Img} src=${src} fallback=${slot ? html`<span class="scard__sglyph num">${slot}</span>` : html`<${GIcon} name="bolt" />`} />
    ${mod && mod.typeName ? html`<span class="scard__mod" data-type=${mod.typeName}><${Img} src=${moduleTypeIconUrl(data.get('local'), mod.typeName)} class="scard__modicon" />${mod.typeName}</span>` : null}
  </span>`;
}

/**
 * Item card (the bar's item slot): the same two taps as an operator card.
 * @param {{ slot:any, idx:number, frozen?:boolean, reason?:string|null, armed?:boolean, onTap?:(idx:number)=>void,
 *   onBuy:Function, onDetail:Function }} props
 */
export function ItemCard({ slot, idx, frozen = false, reason = null, free = false, armed = false, onTap = null, onBuy, onDetail }) {
  const it = data.lookup('items', slot.id);
  const m = data.get('assets');
  const disabled = !!reason;
  const tap = () => { if (onTap) onTap(idx); else if (!disabled) onBuy(idx); else onDetail(slot.id, 'item'); };
  const card = html`<button type="button" class=${cx('scard', 'scard--item', frozen && 'is-frozen', disabled && 'is-disabled', armed && 'is-armed')}
      onClick=${tap} onContextMenu=${(e) => { e.preventDefault(); onDetail(slot.id, 'item'); }}
      aria-label=${T('{0}，价格 {1}{2}', it?.name || T('装备'), slot.price, armed ? (disabled ? T('，无法购买') : T('，再次点击确认')) : '')}
      aria-pressed=${onTap ? String(!!armed) : undefined}>
    <span class="scard__bg" aria-hidden="true"></span>
    <span class="scard__top">
      <${TierChip} tier=${it?.tier ?? 1} size="md" />
      <${PriceHex} slot=${slot} free=${free} poor=${reason === T('资金不足')} />
    </span>
    <span class="scard__itemart"><${Img} src=${itemIconUrl(m, it)} fallback=${html`<${GIcon} name="bolt" />`} /></span>
    <span class="scard__body">
      <span class="scard__name">${it?.name || slot.id}</span>
      <span class="scard__idesc"><${RichText} text=${it?.descRaw || it?.desc || ''} /></span>
    </span>
    ${frozen ? html`<span class="scard__ice" aria-hidden="true"><${Icon} name="snow" /></span>` : null}
    ${armed ? html`<${ArmedTag} reason=${reason} free=${free} />` : null}
  </button>`;
  return reason && reason !== T('已售出') && !armed ? html`<${Tooltip} text=${reason} block=${true} class="scard-wrap">${card}<//>` : card;
}

function SoldCard({ item = false }) {
  return html`<div class=${cx('scard', 'scard--sold', item && 'scard--item')} aria-label=${T('已售出')}>
    <span class="scard__soldtxt"><${MicroLabel}>SOLD OUT</${MicroLabel}><span>${item ? T('已购买') : T('已招募')}</span></span>
  </div>`;
}

function LevelCard({ shop, reason, armed = false, onTap }) {
  const lv = shop?.level ?? 1;
  const max = lv >= (shop?.maxLevel ?? 6);
  const price = shop?.upgradePrice ?? 0;
  return html`<button type="button" class=${cx('lvcard', max && 'is-max', reason && 'is-disabled', armed && 'is-armed')} onClick=${() => !reason && onTap()}
      title=${reason || (armed ? T('再次点击确认升级（{0} 资金）', price) : T('升级调度中心（{0} 资金） · D', price))} aria-disabled=${reason ? 'true' : 'false'}
      aria-pressed=${String(!!armed)}>
    ${!max ? html`<${HexBadge} value=${price} tone=${reason && reason !== T('调度中心已达最高等级') ? 'dark' : 'gold'} size="md" class="lvcard__price" />` : null}
    <span class="lvcard__frame">
      <span class="lvcard__micro">LEVEL</span>
      <b class="lvcard__num num">${lv}</b>
    </span>
    <span class="lvcard__label">${max ? T('已满级') : armed ? T('确认升级') : T('升级')}</span>
    <kbd class="lvcard__key">D</kbd>
  </button>`;
}

/** Key of an armed shop card: kind + slot index + the id it showed (a reroll / sale changes it ⇒ disarm). */
export const armKey = (kind, idx, slot) => `${kind}:${idx}:${slot?.id ?? ''}`;

/**
 * The slot an armed key names (`c` / `i` shop slots, `r` reward slots), or null ('lv', nothing armed, a stale key).
 * @param {string|null} key
 * @param {any[]} slots the shop's slots
 * @param {any[]|null} rewardSlots the shown reward offer's slots
 */
export function armedSlotOf(key, slots, rewardSlots = null) {
  const m = typeof key === 'string' ? /^([cir]):(\d+):(.*)$/.exec(key) : null;
  if (!m) return null;
  const list = m[1] === 'r' ? rewardSlots : slots;
  const s = Array.isArray(list) ? list[Number(m[2])] : null;
  return s && !s.sold && s.id === m[3] ? s : null;
}

/**
 * Two-tap state of the bar (first tap arms, second confirms). Disarms on a tap outside the shop / detail panel, on
 * Escape, when the armed card changes or disappears, and when the bar stops being editable.
 * @param {{ editable: boolean, keys: Set<string> }} o the keys that are currently valid
 */
export function useTwoTap({ editable, keys }) {
  const [armed, setArmed] = useState(null);
  const valid = armed == null || (editable && keys.has(armed));
  useEffect(() => { if (!valid) setArmed(null); }, [valid]);
  useEffect(() => {
    if (armed == null) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('.scard, .lvcard, .dpanel, .modal')) return;
      setArmed(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setArmed(null); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [armed]);
  return [valid ? armed : null, setArmed];
}

/**
 * A free pick-one offer in place of the bar's operator cards (pick 1 — g.reward idx — or put it off: 稍后选择 → the
 * normal shop + a reminder pill): the promotion reward (research 00 §3: 3 free operators of tier min(level+1, 6)) and
 * the special refreshes of strategies, items and 特质 — e.g. 凯瑟琳 【定向投放】 "在调度中心刷新随机3件装备，可以选择并获得
 * 其中1件". Each slot is drawn by its kind: an item slot is an item card (icon, name, tier, description, FREE) — player
 * report #6 after 0.1.0, the items used to be drawn as nameless operator cards — and the header names the offer
 * (gameLogic.offerHeader: 晋升奖励 / the strategy's effect name …; "之后还有 N 项" while more offers wait behind it).
 */
export function RewardCards({ offer, priv, editable, onPick, onDetail, onLater, armed, onTap, offBonds = null }) {
  const head = offerHeader(offer);
  return html`<div class=${cx('shopbar__reward', head.items && 'is-items')} role="group" aria-label=${head.title}>
    <div class="rwtag">
      <${Icon} name=${head.icon} class="rwtag__icon" />
      <b class="rwtag__title">${head.title}</b>
      <span class="rwtag__micro">${head.micro}</span>
      <span class="rwtag__sub">${head.sub}</span>
      ${head.more ? html`<span class="rwtag__sub rwtag__more">${head.more}</span>` : null}
      <button type="button" class="rwtag__later" onClick=${onLater} title=${T('稍后选择（回合结束后消失）')}><${Icon} name="minus" />${T('稍后')}</button>
    </div>
    <div class="shopbar__rwcards">
      ${offer.slots.map((s, i) => {
        if (!s || s.sold) return html`<div key=${`rw${i}`} class=${cx('scard', 'scard--sold', s && s.kind === 'item' && 'scard--item')}><span class="scard__soldtxt"><span>${T('已选择')}</span></span></div>`;
        const kind = s.kind === 'item' ? 'item' : 'chess';
        const reason = shopBlockReason('reward', { priv, editable, slot: s, ...LOOKUPS });
        const props = { slot: { ...s, price: 0 }, idx: i, free: true, reason, armed: armed === armKey('r', i, s), onBuy: onPick, onDetail,
          onTap: (idx) => onTap('r', idx, s, kind, reason, onPick) };
        return kind === 'item' ? html`<${ItemCard} key=${`rw${i}:${s.id}`} ...${props} />` : html`<${ChessCard} key=${`rw${i}:${s.id}`} priv=${priv} offBonds=${offBonds} ...${props} />`;
      })}
    </div>
  </div>`;
}

/**
 * The bar.
 * @param {{ priv:any, editable:boolean, collapsed:boolean, onCollapse:(c:boolean)=>void,
 *   onBuy:(i:number)=>void, onLevel:Function, onRefresh:Function, onFreeze:Function, onDetail:(id:string, kind?:string, hint?:string|null)=>void,
 *   onDetailClose?: () => void, onRefuse?: (reason: string) => void, barRef:any,
 *   reward?: any, onReward?: (idx:number)=>void, onRewardLater?: Function, offBonds?: Set<string>|null }} props — offBonds:
 *   the bonds this mode never activates (gameLogic modeOffBonds), struck through on the operator cards
 */
export function ShopBar({ priv, editable, collapsed, onCollapse, onBuy, onLevel, onRefresh, onFreeze, onDetail, onDetailClose, onRefuse, barRef,
  reward = null, onReward, onRewardLater, onArm = null, offBonds = null }) {
  const shop = priv?.shop || {};
  const slots = Array.isArray(shop.slots) ? shop.slots : [];
  const chessSlots = slots.map((s, i) => ({ s, i })).filter(({ s }) => !s || s.kind !== 'item');
  const itemSlots = slots.map((s, i) => ({ s, i })).filter(({ s }) => s && s.kind === 'item');
  const frozen = !!shop.frozen;
  const funds = Number(priv?.funds) || 0;
  const remaining = Math.max(0, (priv?.deployCap ?? 8) - (priv?.deployCount ?? 0));
  const lvReason = shopBlockReason('levelUp', { priv, editable });
  const refReason = shopBlockReason('refresh', { priv, editable });
  const frzReason = editable ? null : shopBlockReason('freeze', { priv, editable });
  const free = Number(shop.freeRefreshes) || 0;
  const showReward = !!(reward && Array.isArray(reward.slots) && reward.slots.length);

  // two-tap: the keys that may stay armed right now
  const keys = new Set();
  if (!collapsed) {
    if (!lvReason) keys.add('lv');
    slots.forEach((s, i) => { if (s && !s.sold) keys.add(armKey(s.kind === 'item' ? 'i' : 'c', i, s)); });
    if (showReward) reward.slots.forEach((s, i) => { if (s && !s.sold) keys.add(armKey('r', i, s)); });
  }
  const [armed, setArmed] = useTwoTap({ editable, keys });
  // the armed card's slot (game.js lights the tile a merge's elite will take — gameLogic.mergeTarget); kept before the
  // collapsed tab's early return (hook order)
  const armedSlot = armedSlotOf(armed, slots, showReward ? reward.slots : null);
  const armedSig = armedSlot ? `${armedSlot.kind}:${armedSlot.id}` : '';
  useEffect(() => { onArm?.(armedSlot ? { kind: armedSlot.kind === 'item' ? 'item' : 'chess', id: armedSlot.id } : null); }, [armedSig]);
  useEffect(() => () => onArm?.(null), []);
  /** First tap arms + opens the detail; the second buys (or says why it can't). */
  const tapCard = (kind, idx, slot, detailKind, reason, buy) => {
    const key = armKey(kind, idx, slot);
    if (armed !== key) { setArmed(key); onDetail(slot.id, detailKind, detailKind === 'chess' ? mergeHint(priv, slot.id) : null); return; }
    if (reason) { onRefuse?.(reason); return; }
    setArmed(null);
    onDetailClose?.();
    buy(idx);
  };
  const tapLevel = () => {
    if (armed !== 'lv') { setArmed('lv'); return; }
    setArmed(null);
    onLevel();
  };

  if (collapsed) {
    return html`<div class="shopbar-tab" ref=${barRef}>
      <div class="shopbar-tab__funds"><${CoinGlyph} /><b class="num">${funds}</b></div>
      <button type="button" class="shopbar-tab__btn" onClick=${() => onCollapse(false)}><${Icon} name="chevronLeft" />${T('展开商店')}</button>
    </div>`;
  }

  return html`<section class=${cx('shopbar', frozen && 'is-frozen', !editable && 'is-locked', showReward && 'has-reward', armed && 'has-armed')} ref=${barRef} aria-label=${T('调度中心')}>
    <div class="shopbar__tools">
      <span class="shopbar__remain">${TH('剩余可放置角色：{0}', html`<b class=${cx('num', remaining === 0 && 't-orange')}>${remaining}</b>`)}</span>
      <button type="button" class=${cx('toolbtn', 'toolbtn--ice', frozen && 'is-on')} disabled=${!!frzReason} onClick=${onFreeze}
        title=${frzReason || (frozen ? T('解冻商店 · F') : T('冻结商店（下回合保留） · F'))}>
        <${Img} src=${uiUrl(data.get('assets'), frozen ? 'shopPanel/frozen_icon2' : 'shopPanel/frozen_icon')} class="toolbtn__img" fallback=${html`<${Icon} name="snow" />`} />
        <span>${frozen ? T('解冻') : T('冻结')}</span><kbd>F</kbd>
      </button>
      <button type="button" class="toolbtn toolbtn--amber" disabled=${!!refReason} onClick=${onRefresh} title=${refReason || T('刷新商店 · R')}>
        <${Img} src=${uiUrl(data.get('assets'), 'shopPanel/refresh_icon')} class="toolbtn__img" fallback=${html`<${Icon} name="refresh" />`} />
        <span>${T('刷新')}</span>
        ${free > 0 ? html`<span class="toolbtn__free">${T('免费 ×{0}', free)}</span>` : html`<${HexBadge} value=${shop.refreshPrice ?? 1} tone=${refReason ? 'dark' : 'gold'} size="sm" />`}
        <kbd>R</kbd>
      </button>
    </div>
    <div class="shopbar__row">
      <${LevelCard} shop=${shop} reason=${lvReason} armed=${armed === 'lv'} onTap=${tapLevel} />
      ${showReward ? html`<${RewardCards} offer=${reward} priv=${priv} editable=${editable} onPick=${onReward} onDetail=${onDetail} onLater=${onRewardLater}
          armed=${armed} onTap=${tapCard} offBonds=${offBonds} />`
        : html`<div class="shopbar__cards">
        ${chessSlots.map(({ s, i }) => {
          if (!s || s.sold) return html`<${SoldCard} key=${`s${i}`} />`;
          const reason = shopBlockReason('buy', { priv, editable, slot: s, ...LOOKUPS });
          return html`<${ChessCard} key=${`c${i}:${s.id}`} slot=${s} idx=${i} priv=${priv} frozen=${frozen} onBuy=${onBuy} onDetail=${onDetail} offBonds=${offBonds}
              reason=${reason} armed=${armed === armKey('c', i, s)} onTap=${editable ? (idx) => tapCard('c', idx, s, 'chess', reason, onBuy) : null} />`;
        })}
      </div>`}
      <div class="shopbar__item">
        ${itemSlots.length
          ? itemSlots.map(({ s, i }) => {
            if (s.sold) return html`<${SoldCard} key=${`is${i}`} item=${true} />`;
            const reason = shopBlockReason('buy', { priv, editable, slot: s, ...LOOKUPS });
            return html`<${ItemCard} key=${`i${i}:${s.id}`} slot=${s} idx=${i} frozen=${frozen} onBuy=${onBuy} onDetail=${onDetail} reason=${reason}
              armed=${armed === armKey('i', i, s)} onTap=${editable ? (idx) => tapCard('i', idx, s, 'item', reason, onBuy) : null} />`;
          })
          : html`<${SoldCard} item=${true} />`}
      </div>
      <div class="funds">
        <div class="funds__hex">
          <${CoinGlyph} class="funds__coin" />
          <b class="funds__num num">${funds}</b>
        </div>
        <span class="funds__label">${T('目前资金')}</span>
        <button type="button" class="funds__collapse" onClick=${() => onCollapse(true)}><${Icon} name="close" />${T('收起')}</button>
      </div>
    </div>
  </section>`;
}
