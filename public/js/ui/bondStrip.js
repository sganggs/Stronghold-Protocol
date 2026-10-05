// Bond strip (active-bond discs under the top bar) and the bond detail popup: the key facts first (user playtest #2
// item 9: name, members in play / next threshold, layers, reached tier and its threshold row, the current effect with
// layer-resolved numbers), then the full description and the member list with owned / on-board state — operators that
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
// the popup a "👁 name 的盟约" line; its member list reads the teammate's operators on the field (no hand: never sent).

import { html, BondDisc, Icon, MicroLabel, Tooltip } from './components.js';
import { RichText, UnitThumb, BondGlyph, GIcon } from './gameComponents.js';
import { sortBonds, bondMembers, nextThreshold, bondTier, harmonyMembers, HARMONY_BOND, memberHeadCount, briefingBondTip } from './gameLogic.js';
import { formatBondEffect } from './richText.js';
import { bondIconUrl } from './assetUrls.js';
import { data } from '../data.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** The "👁 name" tag of a teammate's strip (DESIGN §20.15). */
function OwnerTag({ owner }) {
  return html`<span class="bstrip__owner" title=${`正在查看 ${owner} 的盟约`} data-owner=${owner}>
    <${GIcon} name="eye" class="bstrip__eye" /><${MicroLabel}>${owner}</${MicroLabel}>
  </span>`;
}

/**
 * @param {{ bonds: any[], layersDisabled?: boolean, onOpen:(bondId:string)=>void, openId?: string|null, max?: number,
 *   owner?: string|null }} props — owner: the watched teammate's name (null = your own bonds)
 */
export function BondStrip({ bonds, layersDisabled = false, onOpen, openId = null, max = 14, owner = null }) {
  const sorted = sortBonds(bonds, (id) => data.lookup('bonds', id));
  if (!sorted.length) {
    return html`<div class=${cx('bstrip', 'bstrip--empty', owner && 'is-other')} data-owner=${owner || null}>
      ${owner ? html`<${OwnerTag} owner=${owner} />` : html`<${MicroLabel}>BONDS</${MicroLabel}>`}<span>${owner ? `${owner} 尚未激活盟约` : '部署干员以激活盟约'}</span></div>`;
  }
  const m = data.get('assets');
  const shown = sorted.slice(0, max);
  const strip = html`<div class=${cx('bstrip', layersDisabled && 'is-frozen', owner && 'is-other')} role="list"
      aria-label=${owner ? `${owner} 的盟约` : '我的盟约'} data-owner=${owner || null}>
    ${owner ? html`<${OwnerTag} owner=${owner} />` : null}
    ${shown.map((b) => {
      const rec = data.lookup('bonds', b.bondId);
      const th = Array.isArray(b.thresholds) && b.thresholds.length ? b.thresholds : rec?.thresholds || [];
      if (b.off) {
        // a bond the mode never activates, with members: the briefing's grey ✕ disc, no stack count, 本局禁用 under it
        const name = rec?.name || b.bondId;
        return html`<div key=${b.bondId} role="listitem" data-bond=${b.bondId} data-off="1"
            class=${cx('bslot', 'is-off', openId === b.bondId && 'is-open')}>
          <${BondDisc} name=${name} icon=${bondIconUrl(m, b.bondId)} tier=${0} maxTier=${Math.max(1, th.length)} active=${false}
            disabled=${true} size="sm" showName=${true} layersDisabled=${layersDisabled} onClick=${() => onOpen(b.bondId)}
            title=${`${briefingBondTip(name, 'off')} · ${b.count ?? 0} 名成员`} />
          <span class="bslot__count bslot__off">本局禁用</span>
        </div>`;
      }
      const next = nextThreshold(b.count ?? 0, th);
      return html`<div key=${b.bondId} role="listitem" data-bond=${b.bondId} data-harmony=${b.harmony > 0 ? b.harmony : null}
          class=${cx('bslot', b.active && 'is-active', openId === b.bondId && 'is-open')}>
        <${BondDisc} name=${rec?.name || b.bondId} icon=${bondIconUrl(m, b.bondId)} layers=${rec?.noStack ? undefined : b.layers ?? 0}
          tier=${b.tier ?? 0} maxTier=${Math.max(1, th.length)} active=${!!b.active} size="sm" showName=${true}
          layersDisabled=${layersDisabled} onClick=${() => onOpen(b.bondId)}
          title=${`${rec?.name || b.bondId} ${b.count ?? 0}/${next ?? th[th.length - 1] ?? '-'}${b.harmony > 0 ? `（含调和 +${b.harmony}）` : ''}`} />
        <span class=${cx('bslot__count', 'num', next == null && 'is-max')}>${b.count ?? 0}<small>/${next ?? th[th.length - 1] ?? '-'}</small></span>
      </div>`;
    })}
    ${sorted.length > shown.length ? html`<span class="bstrip__more num">+${sorted.length - shown.length}</span>` : null}
  </div>`;
  return layersDisabled ? html`<${Tooltip} text="层数叠加已禁用" placement="bottom">${strip}<//>` : strip;
}

/**
 * Bond detail popup.
 * @param {{ bondId: string, entry?: any, priv?: any, banned?: string[], onClose: Function,
 *   onMember?: (chessId:string, items?:string[]|null)=>void,
 *   place?: 'left'|'beside'|'besideR'|'right'|null, over?: boolean, beside?: 'left'|'right'|null, owner?: string|null, off?: boolean }} props —
 *   `place`: where it opens (gameLogic bondPopupPlace; `beside: 'left'` = the older spelling of 'beside'); `over`: above the
 *   detail card; `owner`: the watched teammate's name (`entry` / `priv` are then theirs: ui/watchBonds.js); `onMember`
 *   gets a 变形同构体 row's item ids too (its card shows the pair and the granted chip), null for a plain member; `off`: the
 *   mode never activates this bond (gameLogic modeOffBonds — 标准's 10 inactive bonds): 本局禁用 instead of 未激活, with a
 *   note, no 在场 count and no 当前效果 block (its numbers would promise an effect the mode never gives; the bond text stays).
 *   `entry.harmony` (the server's bond views: the +1 调和 added to `count`): 在场 n（含调和 +1） and the 调和 row
 */
export function BondPopup({ bondId, entry, priv, banned = [], onClose, onMember, place = null, over = false, beside = null, owner = null, off = false }) {
  const b = data.lookup('bonds', bondId);
  if (!b) return null;
  const count = entry?.count ?? 0;
  const layers = entry?.layers ?? 0;
  const th = Array.isArray(entry?.thresholds) && entry.thresholds.length ? entry.thresholds : b.thresholds || [];
  const tier = off ? 0 : entry?.tier ?? bondTier(count, th, b.maxCount);
  const active = !off && (entry ? !!entry.active : tier > 0);
  const getChess = (id) => data.lookup('chess', id);
  const members = bondMembers(b, priv, banned, getChess, (id) => data.lookup('items', id));
  const countsHand = entry?.countsHand ?? b.countsHand;
  const next = nextThreshold(count, th);
  const hasNow = !off && !!(b.effectDescRaw || b.effectDesc);
  const at = place || (beside === 'left' ? 'beside' : 'left');
  // 调和's +1 in this count (the server's word), and the 调和 operators on that board who give it
  const harmony = !off && Number.isInteger(entry?.harmony) && entry.harmony > 0 ? entry.harmony : 0;
  const harmonyBy = harmony ? harmonyMembers(priv, getChess) : [];
  const harmonyName = data.lookup('bonds', HARMONY_BOND)?.name || '调和';
  const harmonyText = `${harmonyBy.length ? `${harmonyBy.map((x) => x.name).join('、')} 在场` : `${harmonyName}已激活`}：核心盟约激活人数 +${harmony}`;
  return html`<div class=${cx('bpop', 'brackets', `bpop--${at}`, over && 'is-over', owner && 'is-other')} data-place=${at} data-owner=${owner || null}
      role="dialog" aria-label=${owner ? `${owner} 的盟约：${b.name}` : `盟约：${b.name}`}>
    <button type="button" class="bpop__close" aria-label="关闭" onClick=${onClose}><${Icon} name="close" /></button>
    <header class="bpop__head">
      <div class=${cx('bpop__disc', active && 'is-active')}><${BondGlyph} bondId=${bondId} /></div>
      <div class="bpop__titles">
        <${MicroLabel} tone="mint">${b.isCore ? 'CORE BOND // 核心盟约' : 'ADD-ON BOND // 附加盟约'}</${MicroLabel}>
        ${owner ? html`<span class="bpop__owner"><${GIcon} name="eye" /><b>${owner}</b> 的盟约</span>` : null}
        <h3 class="bpop__name">${b.name}</h3>
        <div class="bpop__facts">
          ${off ? null : html`<span>在场 <b class="num">${count}</b>${next != null ? html`<small class="num">/${next}</small>` : null}${countsHand ? html`<small>（含整备区）</small>` : null}${harmony ? html`<small class="bpop__hnote" data-harmony=${harmony}>（含${harmonyName} +${harmony}）</small>` : null}</span>`}
          ${b.noStack ? html`<span>层数不显示</span>` : html`<span>层数 <b class="num t-mint">${layers}</b></span>`}
          <span class=${active ? 't-mint' : 't-lo'}>${active ? `已激活${th.length > 1 ? ` · ${tier} 阶` : ''}` : off ? '本局禁用' : '未激活'}</span>
        </div>
      </div>
    </header>
    ${off ? html`<p class="bpop__off" role="note">本模式下该盟约不会激活（其干员仍可能因所属的其他盟约出现）</p>` : null}
    <div class="bpop__tiers">
      ${th.map((n, i) => html`<span key=${i} class=${cx('bpop__tier', i < tier && 'is-on')}><b class="num">${n}</b><small>${b.maxCount != null ? '名及以下' : '名'}</small></span>`)}
    </div>
    ${hasNow ? html`<section class="bpop__sec bpop__sec--now">
      <h4>当前效果 ${b.noStack ? null : html`<small class="num">（${layers} 层）</small>`}</h4>
      <${RichText} as="p" text=${formatBondEffect(b, layers)} class="bpop__desc" />
    </section>` : null}
    <section class="bpop__sec">
      <h4>盟约效果</h4>
      <${RichText} as="p" text=${b.descRaw || b.desc} class="bpop__desc" />
    </section>
    <section class="bpop__sec">
      <h4>成员 <small>${memberHeadCount(members, countsHand)}/${members.length}</small></h4>
      ${harmony ? (harmonyBy.length
        ? html`<button type="button" class="bpop__harmony" data-harmony=${harmony} title=${harmonyText} onClick=${() => onMember?.(harmonyBy[0].id, null)}>
          <${BondGlyph} bondId=${HARMONY_BOND} /><b>${harmonyName} +${harmony}</b><span>${harmonyText}</span></button>`
        : html`<div class="bpop__harmony" role="note" data-harmony=${harmony} title=${harmonyText}>
          <${BondGlyph} bondId=${HARMONY_BOND} /><b>${harmonyName} +${harmony}</b><span>${harmonyText}</span></div>`) : null}
      <div class="bpop__members">
        ${members.map((mb) => html`<button key=${mb.id} type="button" class=${cx('bpop__member', mb.onBoard && 'is-on', mb.owned && !mb.onBoard && 'is-owned', mb.banned && 'is-banned', mb.granted && 'is-granted')}
            onClick=${() => onMember?.(mb.id, mb.granted && Array.isArray(mb.items) ? mb.items : null)} data-granted=${mb.granted ? '1' : null}
            title=${`${mb.name}${mb.granted ? '（变形同构体：视为本盟约成员）' : ''}${mb.banned ? '（本局禁用）' : mb.onBoard ? '（在场）' : mb.owned ? '（整备区）' : ''}`}>
          <${UnitThumb} kind="chess" id=${mb.id} size="sm" dim=${!mb.owned || mb.banned} />
          <span class="bpop__mname">${mb.name}</span>
          ${mb.banned ? html`<span class="bpop__ban"><${Icon} name="close" /></span>` : null}
          ${mb.granted ? html`<span class="bpop__iso" aria-hidden="true">同构</span>` : null}
        </button>`)}
      </div>
    </section>
  </div>`;
}
