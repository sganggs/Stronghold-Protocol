// Bond strip (active-bond discs under the top bar) and the bond detail popup: the key facts first (user playtest #2
// item 9: name, members in play / threshold (gameLogic bondCountCap), layers and reached tier), then the full description and the member list with owned / on-board state — operators that
// are members through 变形同构体 included (tagged 同构, gameLogic bondMembers; such a row opens the wearer's card with its
// items: the pair and the granted chip), so the list's count agrees with 在场 (a bond the mode never activates says
// 本局禁用 — gameLogic modeOffBonds). A core bond whose count holds 调和's +1 (the view entry's `harmony`, sent by the
// server — server/match/bondsMeta.js; never re-derived here) says so: 在场 n（含调和 +1）, and a 调和 row heads the member
// list naming the 调和 operators on that board (gameLogic harmonyMembers: 缪尔赛思 …; a tap opens the first one's card) —
// the +1 used to read as a miscount (GitHub issue #1, DESIGN §21.26). Opened from the detail panel's bond chips it docks
// beside that panel (`beside`: the panel's side).
// Research 06 §11.1: round mint discs, stack count over the disc, name below, sorted by stacks; grey =
// present but inactive; in 联防 / boss rounds the strip is dimmed ("层数叠加已禁用"). A bond the mode never activates
// that the player has members of (the server's `off` entry — server/match/bondsMeta.js offBondCounts: 标准's 投资人 奇迹
// 突袭 独行 …) comes last as a grey disc with ✕ and 本局禁用 under it instead of its count (community reports
// 「投资人等在休整区就能生效的盟约不生效」 / 「…不会触发斯卡蒂与异德的突袭」: the bond just vanished, 0.1.3). The popup's 成员
// header counts the hand members too for a bond that counts the hand (投资人 远见 奇迹: gameLogic memberHeadCount), as 在场
// already did.
// Watching a teammate (DESIGN §20.15, ui/watchBonds.js) the strip and the popup show THAT player's bonds and layers:
// the strip carries an amber "👁 name" tag (`owner`, the observing pill's spelling, research 09 §3.1) and amber rings,
// the popup a "👁 name 的盟约" line; its member list reads the teammate's operators on the field — in prep their bench
// too, counted like their own popup counts it (ui/watchBonds.js ownerBoard: hand / temp by the scout's `area`, GitHub
// #385); a battle sends no bench.
// 0.2.0 补位: a member the player fields as its stand-in (the own m.private.standIns; a teammate's unit that says so —
// UnitInfo `standInFor`) is drawn as the stand-in — avatar, name, a small 「替补」 mark on the thumbnail — and its row
// opens the stand-in's card (gameLogic memberStandIn; the owner's recall of the official mode, 2026-10-06).
// 0.2.1 自选编队 (the owner's report of 2026-10-07): each 自选 pick of the player (m.private.diy) is a row of every bond its
// operator carries — the operator's name and portrait with the 「自选」 tag, dimmed until owned (not bought, or not in the
// shop yet), ✕ when all its bonds are off this match (m.private.diyBanned) — and opens the operator's card; a watched
// teammate's 自选 pieces on the field are rows too (their picks are not sent), opening THEIR operator's card (the unit's
// pick goes with onMember: never the empty 甄选干员 slot's card). A 自选 piece that is a member through 变形同构体 shows its
// operator too, with the 「同构」 tag (#846: it showed the empty slot's 「甄」).

import { cloneElement } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, BondDisc, bondFrame, Icon, MicroLabel, Tooltip } from './components.js';
import { RichText, BondGlyph, GIcon, Sprite, Img, SquareOperatorThumb } from './gameComponents.js';
import { stripBondList, bondMembers, bondCountCap, bondTier, bondStage, bondPhased, harmonyMembers, HARMONY_BOND, briefingBondTip, diyGetter, diyRecordFor, memberStandIn, standInForText } from './gameLogic.js';
import { bondIconUrl, uiUrl } from './assetUrls.js';
import { formatBondEffect } from './richText.js';
import { bondEffectRecord } from './bondEffect.js';
import { data } from '../data.js';
import { t, tParts, tName } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// Missing manifest entries must not produce guessed asset requests.
function uiBackground(key) {
  const url = uiUrl(data.get('assets'), key);
  return url ? `url("${url}")` : 'none';
}

/** The "👁 name" tag of a teammate's strip (DESIGN §20.15). */
function OwnerTag({ owner }) {
  return html`<span class="bstrip__owner" title=${t('正在查看 {owner} 的盟约', { owner })} data-owner=${owner}>
    <${GIcon} name="eye" class="bstrip__eye" /><${MicroLabel}>${owner}</${MicroLabel}>
  </span>`;
}

/** Mouse travel (CSS px) before a press on the strip becomes a drag — below it the press stays a disc's click. */
export const BOND_DRAG_SLOP = 5;

/**
 * The strip's horizontal scroller. No arrow buttons any more (the owner, 2026-11-14 「盟约行左右箭头取消吧，直接鼠标拖动
 * 或者手指滑动就好，收起的小箭头还保留」, §37.201): a finger swipes it natively (touch-action pan-x), a mouse drags it
 * (past BOND_DRAG_SLOP the press is a drag and the click that ends it opens no popup), the wheel scrolls it sideways, the
 * keyboard's arrows still scroll the focused strip; a fading edge says more bonds wait on that side.
 */
function BondScroller({ count, children }) {
  const viewport = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((old) => old.left === left && old.right === right ? old : { left, right });
    };
    // A render can resize the observed slots too. Update after observer delivery, so those changes are measured in the
    // next frame rather than producing "ResizeObserver loop completed with undelivered notifications" during prep.
    let frame = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; update(); });
    });
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    el.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      el.removeEventListener('scroll', update);
    };
  }, [viewport, count]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    /** @type {{ id: number, x: number, left: number, moved: boolean }|null} */
    let press = null;
    let swallow = false;
    const down = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth <= el.clientWidth + 1) return;
      press = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false };
    };
    const move = (e) => {
      if (!press || e.pointerId !== press.id) return;
      const dx = e.clientX - press.x;
      if (!press.moved) {
        if (Math.abs(dx) < BOND_DRAG_SLOP) return;
        press.moved = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
        setDragging(true);
      }
      el.scrollLeft = press.left - dx;
      e.preventDefault();
    };
    const up = (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (press.moved) swallow = true;
      press = null;
      setDragging(false);
    };
    // the click a drag ends with (its target: the disc pressed, or the strip holding the capture) opens nothing
    const click = (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    };
    // a vertical wheel scrolls the row sideways while it has room that way (the board's own wheel zoom never sees it)
    const wheel = (e) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d || el.scrollWidth <= el.clientWidth + 1) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max - 1)) return;
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + d));
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
      el.removeEventListener('wheel', wheel);
    };
  }, [viewport]);
  return html`<div class=${cx('bstrip-scroll', edges.left && 'is-l', edges.right && 'is-r', (edges.left || edges.right) && 'can-drag', dragging && 'is-dragging')}>
    ${cloneElement(children, { ref: viewport })}
  </div>`;
}

/** The numeral over the disc (gameLogic bondStage; nothing at 0). Use the original III sprite; crop out five-pixel stroke periods for I and II. */
function BondStage({ stage }) {
  const [badSrc, setBadSrc] = useState(null);
  if (!(stage > 0)) return null;
  const numeral = stageNumeral(stage);
  const label = t('阶段 {tier}', { tier: numeral });
  const src = uiUrl(data.get('assets'), 'hudBondItem/bond_level_3');
  if (stage > 3 || !src || badSrc === src) return html`<span class="bslot__stage" aria-label=${label}>${numeral}</span>`;
  const left = stage === 1 ? .09 : stage === 2 ? .14 : .24;
  return html`<span class="bslot__stage" aria-label=${label} title=${label}>
    <span class="bslot__stage-sprite" style=${`--stage-left: ${left}rem; --stage-width: ${stage === 3 ? .24 : left + .05}rem`} aria-hidden="true">
      <span class="bslot__stage-left"><img src=${src} alt="" draggable=${false} onError=${() => setBadSrc(src)} /></span>
      ${stage < 3 ? html`<span class="bslot__stage-right"><img src=${src} alt="" draggable=${false} onError=${() => setBadSrc(src)} /></span>` : null}
    </span>
  </span>`;
}

const stageNumeral = (stage) => ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'][stage - 1] || stage;

/**
 * What a strip slot and the popup show of an entry. `tier`: the member tier (the disc, the 在场 count's threshold);
 * `stage`: the numeral over the disc and the popup's 阶段 tag (gameLogic bondStage: in 规程 the official phase level of
 * the active effect, from the live layers the entry carries in battle — ui/watchBonds.js withLiveLayers /
 * withTemporaryLayers — so it flips mid-battle; §37.341; always 0 in a 盟约 period, §37.342); `phased`: the version
 * draws the bond phase (gameLogic bondPhased: 规程) — the numeral, the strip's unbroken ring (the popup's header disc is
 * split by the first threshold in both families), the popup's 阶段 tag.
 */
export function bondDisplay(bondId, entry) {
  const base = data.lookup('bonds', bondId);
  const count = entry?.count ?? 0;
  const layers = entry?.layers ?? 0;
  const tempLayers = entry?.tempLayers ?? 0;
  const total = layers + tempLayers;
  const effectId = entry?.effectId;
  const record = bondEffectRecord(base, data.lookup('effects', effectId || base?.effectId), total);
  const thresholds = !effectId && Array.isArray(entry?.thresholds) && entry.thresholds.length
    ? entry.thresholds : record?.thresholds || [];
  const tier = !effectId && entry?.tier != null ? entry.tier : bondTier(count, thresholds, record?.maxCount);
  // the record is the active effect's (bondEffectRecord): a strategy's replacement brings its own phase table
  const phased = bondPhased(data.get('config'));
  const stage = bondStage({ active: entry ? !!entry.active : tier > 0, tier, count, layers, tempLayers }, record, phased);
  return { record, count, thresholds, tier, stage, phased, layers, tempLayers, total };
}

/**
 * @param {{ bonds: any[], layersDisabled?: boolean, onOpen:(bondId:string)=>void, openId?: string|null,
 *   owner?: string|null }} props — owner: the watched teammate's name (null = your own bonds)
 */
export function BondStrip({ bonds, layersDisabled = false, onOpen, openId = null, owner = null }) {
  // A zero-count mapped row exists so the popup can resolve it. It is not a strip icon (stripBondList).
  const sorted = stripBondList(bonds, (id) => data.lookup('bonds', id));
  if (!sorted.length) {
    return html`<div class=${cx('bstrip', 'bstrip--empty', owner && 'is-other')} data-owner=${owner || null}>
      ${owner ? html`<${OwnerTag} owner=${owner} />` : html`<${MicroLabel}>BONDS</${MicroLabel}>`}<span>${owner ? t('{owner} 尚未激活盟约', { owner }) : t('部署干员以激活盟约')}</span></div>`;
  }
  const m = data.get('assets');
  const shown = sorted;
  const strip = html`<div tabindex="0" class=${cx('bstrip', layersDisabled && 'is-frozen', owner && 'is-other')} role="list"
      aria-label=${owner ? t('{owner} 的盟约', { owner }) : t('我的盟约')} data-owner=${owner || null}>
    ${owner ? html`<${OwnerTag} owner=${owner} />` : null}
    ${shown.map((b) => {
      const { record: rec, thresholds: th, count, tier, stage, phased, tempLayers, total } = bondDisplay(b.bondId, b);
      // the disc's sprite (the full ring once active, at every tier): the stage numeral sits on its rim (规程 only)
      const { full } = bondFrame(b.off ? { disabled: true } : { active: !!b.active, members: count, minCount: th[0] ?? 0, phased });
      const frameStyle = `--bond-frame-size: ${full ? '.815' : '.688'}rem; --bond-rim-top: ${full ? 13 / 77 : 8 / 65}`;
      if (b.off) {
        // a bond the mode never activates, with members: the briefing's grey ✕ disc, no stack count, 本局禁用 under it
        const name = rec?.name || b.bondId;
        return html`<div key=${b.bondId} role="listitem" data-bond=${b.bondId} data-off="1"
            class=${cx('bslot', 'is-off', openId === b.bondId && 'is-open')} style=${frameStyle}>
          <${BondDisc} name=${name} icon=${bondIconUrl(m, b.bondId)} tier=${0} active=${false}
            disabled=${true} size="sm" showName=${true} layersDisabled=${layersDisabled} onClick=${() => onOpen(b.bondId)}
            title=${t('{tip} · {n} 名成员', { tip: briefingBondTip(name, 'off'), n: count })} />
          <span class="bslot__count bslot__off">${t('本局禁用')}</span>
        </div>`;
      }
      // the tooltip's count: the popup's denominator (gameLogic bondCountCap)
      const cap = bondCountCap(th);
      return html`<div key=${b.bondId} role="listitem" data-bond=${b.bondId} data-harmony=${b.harmony > 0 ? b.harmony : null}
          class=${cx('bslot', b.active && 'is-active', tempLayers > 0 && 'has-temp-layers', full && 'is-full', openId === b.bondId && 'is-open')} style=${frameStyle}>
        <${BondDisc} name=${rec?.name || b.bondId} icon=${bondIconUrl(m, b.bondId)} layers=${rec?.noStack ? undefined : total}
          tier=${tier} members=${count} minCount=${th[0] ?? 0} active=${!!b.active} phased=${phased} size="sm" showName=${true}
          layersDisabled=${layersDisabled} onClick=${() => onOpen(b.bondId)}
          title=${`${rec?.name || b.bondId} ${count}/${cap ?? '-'}${b.harmony > 0 ? t('（含调和 +{harmony}）', { harmony: b.harmony }) : ''}`} />
    <${BondStage} stage=${stage} />
      </div>`;
    })}
  </div>`;
  const content = html`<${BondScroller} count=${sorted.length}>${strip}<//>`;
  return layersDisabled ? html`<${Tooltip} text=${t('层数叠加已禁用')} placement="bottom">${content}<//>` : content;
}

/**
 * Bond detail popup.
 * @param {{ bondId: string, entry?: any, priv?: any, banned?: string[], onClose: Function,
 *   onPrevious?: (()=>void)|null, onNext?: (()=>void)|null,
 *   onMember?: (chessId:string, items?:string[]|null, standInFor?:string|null, diy?:any)=>void,
 *   place?: 'left'|'beside'|'besideR'|'right'|'center'|null, over?: boolean, beside?: 'left'|'right'|'center'|null, owner?: string|null, ownerId?: string|null, off?: boolean, morphMode?: string, modal?: boolean }} props —
 *   `place`: where it opens (gameLogic bondPopupPlace; `beside: 'left'` = the older spelling of 'beside'); `over`: above the
 *   detail card; `owner`: the watched teammate's name (`entry` / `priv` are then theirs: ui/watchBonds.js); `onMember`
 *   gets a 变形同构体 row's item ids too (its card shows the pair and the granted chip), null for a plain member, and a
 *   stand-in row's `standInFor` (0.2.0 补位: a teammate's card then shows the stand-in too), and a teammate's 自选 row's
 *   pick (`diy`, its unit's: the card composes their operator; the own rows' card reads m.private.diy); `off`: the
 *   mode never activates this bond (gameLogic modeOffBonds — 标准's 10 inactive bonds): 本局禁用 instead of 未激活, with a
 *   note, no 在场 count and no 当前效果 block (its numbers would promise an effect the mode never gives; the bond text stays).
 *   `coreAbsent` (matchInfo regulationCoreAbsent): a regulation core the match has greyed. Its operators appear only
 *   through another lit bond, so the card does not take the `off` branch (that note is about a bond the mode never
 *   activates). It keeps the effect and the members, and says 「{name}：该核心盟约的干员无法出现，同属其他亮着的核心盟约的除外」.
 *   An add-on stays on `off`.
 *   `entry.harmony` (the server's bond views: the +1 调和 added to `count`): 在场 n（含调和 +1） and the 调和 row
 */
export function BondPopup({ bondId, entry, priv, banned = [], onClose, onMember, place = null, over = false, beside = null, owner = null, ownerId, off = false, coreAbsent = false, morphMode = 'official', modal = false, onPrevious = null, onNext = null }) {
  const { record: b, count, thresholds: th, tier: reachedTier, stage: reachedStage, phased, layers, tempLayers, total } = bondDisplay(bondId, entry);
  if (!b) return null;
  // A greyed regulation core has its own explanation, distinct from a mode-disabled bond.
  const modeOff = !!off && !coreAbsent;
  const tier = modeOff ? 0 : reachedTier;
  const active = !modeOff && (entry ? !!entry.active : tier > 0);
  // the 阶段 tag shows the strip's numeral (§37.341): none while it is 0 (调和, 远见 below 80 layers in 规程; every bond in
  // a 盟约 period, whose popup has no tier tag: §37.342)
  const stage = active ? reachedStage : 0;
  // (自选 pieces are their operators: the own ones by m.private.diy, a watched teammate's by the pick its unit carries)
  const dd = { chess: data.get('chess'), backups: data.get('backups') };
  const getChess = diyGetter((id) => data.lookup('chess', id), priv, dd);
  const pieceRecord = (p) => (p && p.diy && typeof p.diy === 'object' ? diyRecordFor(data.lookup('chess', p.id), p.diy, dd) : null) || getChess(p.id);
  const members = bondMembers(b, priv, banned, getChess, (id) => data.lookup('items', id), pieceRecord, morphMode);
  // 补位: the stand-in a row shows (a 自选 row — a member, or one through 变形同构体 with its record `rec` — is its operator already)
  const rawChess = (id) => data.lookup('chess', id);
  const siOf = (mb) => (mb.diy || mb.rec ? null : memberStandIn(priv, rawChess(mb.id), data.get('backups'), rawChess));
  const countsHand = entry?.countsHand ?? b.countsHand;
  // the 在场 count's denominator (gameLogic bondCountCap): the FIRST threshold, as the official popup draws it in both
  // families (§37.342: 盟约 维多利亚 7/3 ✓, BV1yyC9BPEXV 1600 s; 规程 不屈 3/2 ✓ 阶段Ⅱ, PR #923's round-11 screenshot)
  const cap = bondCountCap(th) ?? '-';
  const at = place || (beside === 'left' ? 'beside' : 'left');
  // the header disc (split): once active, the lit ring split by the first threshold (N_N) in both families — 盟约 as on
  // its strip (§37.342), 规程 unlike its strip's unbroken 1_1: in PR #923's round-11 screenshot the open 不屈 card
  // ([2,3], 3 members) draws 2_2 while the strip's 不屈 disc is unbroken. Before activation the member progress, as before.
  // 调和's +1 in this count (the server's word), and the 调和 operators on that board who give it
  const harmony = !modeOff && Number.isInteger(entry?.harmony) && entry.harmony > 0 ? entry.harmony : 0;
  const harmonyBy = harmony ? harmonyMembers(priv, getChess).map((x) => {
    const si = memberStandIn(priv, rawChess(x.id), data.get('backups'), rawChess);
    return si ? { ...x, name: si.name } : x;
  }) : [];
  const harmonyName = data.lookup('bonds', HARMONY_BOND)?.name || tName('调和');
  const harmonyText = harmonyBy.length ? t('{names} 在场：核心盟约激活人数 +{harmony}', { names: harmonyBy.map((x) => x.name), harmony })
    : t('{harmonyName}已激活：核心盟约激活人数 +{harmony}', { harmonyName, harmony });
  const card = html`<div class=${cx('bpop', 'brackets', `bpop--${at}`, over && 'is-over', owner && 'is-other')} data-place=${at} data-owner=${owner || null}
      role="dialog" aria-modal=${modal || undefined} aria-label=${owner ? t('{owner} 的盟约：{name}', { owner, name: b.name }) : t('盟约：{name}', { name: b.name })}>
  ${active ? html`<${Img} class="bpop__stack-deco" src=${uiUrl(data.get('assets'), 'bondDetail/active_stack_deco')} />` : null}
  ${modal ? html`<button type="button" class="bpop__close" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>` : null}
  <header class=${cx('bpop__head', active && 'is-active')}>
    <div class="bpop__disc">
      <${BondDisc} name=${b.name} icon=${bondIconUrl(data.get('assets'), bondId)} tier=${tier}
        members=${count} minCount=${th[0] ?? 0} active=${active} disabled=${modeOff || coreAbsent} phased=${phased} split=${true} showName=${false} />
    </div>
    <div class="bpop__titles">
      ${owner ? html`<span class="bpop__owner"><${GIcon} name="eye" />${tParts('{owner} 的盟约', { owner: html`<b>${owner}</b>` })}</span>` : null}
      <h3 class="bpop__name">${b.name}</h3>
      <div class="bpop__facts">
        ${modeOff ? null : html`<span class=${cx('bpop__population', !active && 'is-inactive')} style=${!active ? `--bpop-inactive-bg: ${uiBackground('bondDetail/bond_inactive_bg')}` : null}>
          <${Icon} name="users" /><span class="sr-only">${t('在场')}</span>
          <span class="bpop__tally"><b class="num bpop__count">${count}</b><span class="num bpop__cap">/${cap}</span></span>
          ${active ? html`<span class="bpop__check" aria-label=${t('已激活')}><${Icon} name="check" /></span>` : html`<span class="bpop__stage bpop__inactive">${t('尚未激活')}</span>`}
        </span>`}
        ${countsHand && !modeOff ? html`<small>${t('（含整备区）')}</small>` : null}
        ${harmony ? html`<small class="bpop__hnote" data-harmony=${harmony}>${t('（含{harmonyName} +{harmony}）', { harmonyName, harmony })}</small>` : null}
        ${stage > 0 ? html`<span class="bpop__stage is-active" title=${t('已激活 · {tier} 阶', { tier: stage })}>${t('阶段 {tier}', { tier: stageNumeral(stage) })}</span>`
          : modeOff ? html`<span class="bpop__stage">${t('本局禁用')}</span>` : null}
      </div>
    </div>
    ${b.noStack ? null : html`<div class="bpop__layers" aria-label=${t('层数')}>
      <span style=${`--bpop-layer-bg: ${uiBackground('bondDetail/bond_active_bg')}`}>${t('层数')} <b class="num t-mint">${layers}</b></span>
      ${tempLayers > 0 ? html`<span class="bpop__temporary num">+${tempLayers}</span>` : null}
    </div>`}
  </header>
  <div class="bpop__body">
  ${coreAbsent ? html`<p class="bpop__off" role="note">${briefingBondTip(b.name, 'off', 0, true)}</p>` : modeOff ? html`<p class="bpop__off" role="note">${t('本模式下该盟约不会激活（其干员仍可能因所属的其他盟约出现）')}</p>` : null}
    <section class="bpop__sec">
      <${RichText} as="p" text=${formatBondEffect(b, total)} class="bpop__desc" />
    </section>
    <section class="bpop__sec">
      ${harmony ? (harmonyBy.length
        ? html`<button type="button" class="bpop__harmony" data-harmony=${harmony} title=${harmonyText} onClick=${() => onMember?.(harmonyBy[0].id, null)}>
          <${BondGlyph} bondId=${HARMONY_BOND} /><b>${harmonyName} +${harmony}</b><span>${harmonyText}</span></button>`
        : html`<div class="bpop__harmony" role="note" data-harmony=${harmony} title=${harmonyText}>
          <${BondGlyph} bondId=${HARMONY_BOND} /><b>${harmonyName} +${harmony}</b><span>${harmonyText}</span></div>`) : null}
      <div class="bpop__members" style=${`--bpop-inactive-border: ${uiBackground('bondChar/avatar_border')}`}>
        ${members.filter(mb => !mb.banned).map((mb) => {
          const si = siOf(mb);
          const name = si ? si.name : mb.name;
          const items = mb.granted && Array.isArray(mb.items) ? mb.items : null;
          return html`<${onMember ? 'button' : 'div'} key=${mb.id} type=${onMember ? 'button' : undefined} class=${cx('bpop__member', mb.onBoard && 'is-on', mb.owned && !mb.onBoard && 'is-owned', mb.granted && 'is-granted', si && 'is-standin')}
              onClick=${onMember ? () => (si ? onMember(mb.id, items, si.standInFor) : mb.pick ? onMember(mb.id, items, null, mb.pick) : onMember(mb.id, items)) : undefined}
              data-granted=${mb.granted ? '1' : null} data-standin=${si ? si.charId : null} data-diy=${mb.diy ? mb.rec?.charId || '1' : null}
              title=${`${name}${si ? t('（{note}）', { note: standInForText(mb.name) }) : ''}${mb.granted ? t('（变形同构体：视为本盟约成员）') : ''}${mb.onBoard ? t('（在场）') : mb.owned ? t('（整备区）') : ''}`}>
            <${SquareOperatorThumb} id=${mb.id} ownerId=${ownerId ?? priv?.playerId} dim=${!mb.owned} rec=${si || mb.rec || getChess(mb.id)} title=${name} />
            <span class="bpop__mname">${name}</span>
            ${mb.granted ? html`<span class="bpop__iso" aria-hidden="true">${t('同构')}</span>` : null}
            ${mb.diy ? html`<span class="bpop__iso bpop__diy" data-diy="1" aria-hidden="true">${t('自选')}</span>` : null}
          <//>`;
        })}
      </div>
    </section>
  </div>
  </div>`;
  if (!onPrevious && !onNext) return card;
  return html`<div class="bpop-nav">
    <button type="button" class="bpop-nav__arrow bpop-nav__arrow--prev" aria-label=${t('上一个盟约')} disabled=${!onPrevious} onClick=${onPrevious}><${Sprite} k="bondDetail/arrow" class="bpop-nav__image" fallback=${html`<${Icon} name="chevronRight" class="bpop-nav__image" />`} /></button>
    ${card}
    <button type="button" class="bpop-nav__arrow bpop-nav__arrow--next" aria-label=${t('下一个盟约')} disabled=${!onNext} onClick=${onNext}><${Sprite} k="bondDetail/arrow" class="bpop-nav__image" fallback=${html`<${Icon} name="chevronRight" class="bpop-nav__image" />`} /></button>
  </div>`;
}
