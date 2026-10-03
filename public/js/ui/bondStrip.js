// Bond strip (active-bond discs under the top bar) and the bond detail popup: the key facts first (user playtest #2
// item 9: name, members in play / next threshold, layers, reached tier and its threshold row, the current effect with
// layer-resolved numbers), then the full description and the member list with owned / on-board state. Opened from
// the detail panel's bond chips it docks beside that panel (`beside`: the panel's side).
// Research 06 §11.1: round mint discs, stack count over the disc, name below, sorted by stacks; grey =
// present but inactive; in 联防 / boss rounds the strip is dimmed ("层数叠加已禁用").
// Watching a teammate (DESIGN §20.15, ui/watchBonds.js) the strip and the popup show THAT player's bonds and layers:
// the strip carries an amber "👁 name" tag (`owner`, the observing pill's spelling, research 09 §3.1) and amber rings,
// the popup a "👁 name 的盟约" line; its member list reads the teammate's operators on the field (no hand: never sent).

import { html, BondDisc, Icon, MicroLabel, Tooltip } from './components.js';
import { RichText, UnitThumb, BondGlyph, GIcon } from './gameComponents.js';
import { sortBonds, bondMembers, nextThreshold, bondTier } from './gameLogic.js';
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
      const next = nextThreshold(b.count ?? 0, th);
      return html`<div key=${b.bondId} role="listitem" data-bond=${b.bondId} class=${cx('bslot', b.active && 'is-active', openId === b.bondId && 'is-open')}>
        <${BondDisc} name=${rec?.name || b.bondId} icon=${bondIconUrl(m, b.bondId)} layers=${b.layers ?? 0}
          tier=${b.tier ?? 0} maxTier=${Math.max(1, th.length)} active=${!!b.active} size="sm" showName=${true}
          layersDisabled=${layersDisabled} onClick=${() => onOpen(b.bondId)}
          title=${`${rec?.name || b.bondId} ${b.count ?? 0}/${next ?? th[th.length - 1] ?? '-'}`} />
        <span class=${cx('bslot__count', 'num', next == null && 'is-max')}>${b.count ?? 0}<small>/${next ?? th[th.length - 1] ?? '-'}</small></span>
      </div>`;
    })}
    ${sorted.length > shown.length ? html`<span class="bstrip__more num">+${sorted.length - shown.length}</span>` : null}
  </div>`;
  return layersDisabled ? html`<${Tooltip} text="层数叠加已禁用" placement="bottom">${strip}<//>` : strip;
}

/**
 * Bond detail popup.
 * @param {{ bondId: string, entry?: any, priv?: any, banned?: string[], onClose: Function, onMember?: (chessId:string)=>void,
 *   place?: 'left'|'beside'|'besideR'|'right'|null, over?: boolean, beside?: 'left'|'right'|null, owner?: string|null }} props —
 *   `place`: where it opens (gameLogic bondPopupPlace; `beside: 'left'` = the older spelling of 'beside'); `over`: above the
 *   detail card; `owner`: the watched teammate's name (`entry` / `priv` are then theirs: ui/watchBonds.js)
 */
export function BondPopup({ bondId, entry, priv, banned = [], onClose, onMember, place = null, over = false, beside = null, owner = null }) {
  const b = data.lookup('bonds', bondId);
  if (!b) return null;
  const count = entry?.count ?? 0;
  const layers = entry?.layers ?? 0;
  const th = Array.isArray(entry?.thresholds) && entry.thresholds.length ? entry.thresholds : b.thresholds || [];
  const tier = entry?.tier ?? bondTier(count, th, b.maxCount);
  const active = entry ? !!entry.active : tier > 0;
  const members = bondMembers(b, priv, banned, (id) => data.lookup('chess', id), (id) => data.lookup('items', id), (id) => !!data.lookup('bonds', id));
  const countsHand = entry?.countsHand ?? b.countsHand;
  const next = nextThreshold(count, th);
  const hasNow = !!(b.effectDescRaw || b.effectDesc);
  const at = place || (beside === 'left' ? 'beside' : 'left');
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
          <span>在场 <b class="num">${count}</b>${next != null ? html`<small class="num">/${next}</small>` : null}${countsHand ? html`<small>（含整备区）</small>` : null}</span>
          <span>层数 <b class="num t-mint">${layers}</b></span>
          <span class=${active ? 't-mint' : 't-lo'}>${active ? `已激活${th.length > 1 ? ` · ${tier} 阶` : ''}` : '未激活'}</span>
        </div>
      </div>
    </header>
    <div class="bpop__tiers">
      ${th.map((n, i) => html`<span key=${i} class=${cx('bpop__tier', i < tier && 'is-on')}><b class="num">${n}</b><small>${b.maxCount != null ? '名及以下' : '名'}</small></span>`)}
    </div>
    ${hasNow ? html`<section class="bpop__sec bpop__sec--now">
      <h4>当前效果 <small class="num">（${layers} 层）</small></h4>
      <${RichText} as="p" text=${formatBondEffect(b, layers)} class="bpop__desc" />
    </section>` : null}
    <section class="bpop__sec">
      <h4>盟约效果</h4>
      <${RichText} as="p" text=${b.descRaw || b.desc} class="bpop__desc" />
    </section>
    <section class="bpop__sec">
      <h4>成员 <small>${members.filter((x) => x.onBoard).length}/${members.length}</small></h4>
      <div class="bpop__members">
        ${members.map((mb) => html`<button key=${mb.id} type="button" class=${cx('bpop__member', mb.onBoard && 'is-on', mb.owned && !mb.onBoard && 'is-owned', mb.banned && 'is-banned')}
            onClick=${() => onMember?.(mb.id)} title=${`${mb.name}${mb.banned ? '（本局禁用）' : mb.onBoard ? '（在场）' : mb.owned ? '（整备区）' : ''}`}>
          <${UnitThumb} kind="chess" id=${mb.id} size="sm" dim=${!mb.owned || mb.banned} />
          <span class="bpop__mname">${mb.name}</span>
          ${mb.banned ? html`<span class="bpop__ban"><${Icon} name="close" /></span>` : null}
        </button>`)}
      </div>
    </section>
  </div>`;
}
