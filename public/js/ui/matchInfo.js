// Match info — the bonds and banned operators of a match (research 06 §4.1 "1/2 确认本局信息", research 01 A2 / 06
// addendum D), one implementation for every place that shows them, so they never drift:
//   * the INFO_CHECK briefing's right column (screens/briefing.js);
//   * the strategy draft's 本局信息 dialog (screens/bandDraft.js; GitHub issue #8 item 1 "选策略时没法返回查看禁用的干员和盟约":
//     players choose a strategy partly by the bonds and operators the match leaves them);
//   * the data of the in-game 本局信息 tab (ui/enemyDrawer.js InfoTab, its own compact chips and avatars).
// matchInfoModel (pure) derives everything from m.public and the static data: the two kinds of greyed bonds
// (gameLogic disabledBondSets over config.modes[modeId].inactiveBondIds — the drawn set D "部分盟约所含干员阵容不完整",
// still activatable through other bonds' operators or items, and the mode's static inactive bonds "本局禁用", e.g.
// 标准模拟's 10), every bond in the briefing order (bondOrder, then identifier) split into 核心 / 附加, the banned
// operators (m.public bannedChess, known chess only) sorted by tier, the banned-member count per bond (gameLogic
// bannedPerBond) and — from the viewer's own m.private — its slotted 自选 pieces left out of the shop because all their
// bonds are off (gameLogic diyBannedPieces; 0.2.0). The blocks are hookless (unit-tested by calling them): the 核心盟约 /
// 附加盟约 rows of bond discs —
// greyed with the ✕, the red banned-member badge, the briefingBondTip tooltip — the legend and the 本局禁用干员 grid.
// MatchInfoDialog shows the same blocks and the caller's enemy information read-only in a components.js Modal
// (关闭, a tap outside or Esc close it) with a status line (the draft's turn and countdown stays in view).
// Styles: css/screens/briefing.css (.brief-*), css/screens/draft.css (.minfo-dlg).

import { useRef } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, BondDisc, Tooltip, Modal, useModalFocus } from './components.js';
import { BondPopup } from './bondStrip.js';
import { UnitThumb } from './gameComponents.js';
import { bannedPerBond, disabledBondSets, briefingBondTip, diyBannedPieces } from './gameLogic.js';
import { bondIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { BOND_GROUP_HINT, REGULATION_BOND_LEGEND, REGULATION_LEGEND_CHIP } from './gameLogic/bonds.js';
import { t, dn, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * @typedef {{ sets: { drawn: Set<string>, off: Set<string> }, stateOf: (bondId: string) => 'off'|'drawn'|null,
 *   bonds: any[], core: any[], addon: any[], banned: string[], perBond: Map<string, number>,
 *   regulation: boolean, choice: { groups: string[][], picked: number|null }|null,
 *   diyBanned: Array<{ slotId: string, charId: string, name: string }> }} MatchInfoModel
 */

/**
 * Everything the match-info blocks show.
 * @param {any} pub m.public (drawnDisabledBonds / disabledBonds, bannedChess)
 * @param {{ bonds?: any[], chess?: (id: string) => any, mode?: any, priv?: any, diyData?: any }} [src]
 *   bonds: bonds.json records (data.list('bonds')); chess: the chess lookup; mode: config.json modes[pub.modeId]; priv: the
 *   viewer's m.private (its 自选 pieces out of the shop, diyBanned) with diyData (`{ chess, backups }`: data.get('chess') /
 *   data.get('backups')) to name them
 * @returns {MatchInfoModel}
 *   stateOf: 'off' = the mode never activates the bond (本局禁用), 'drawn' = in the drawn set D (阵容不完整), null = normal;
 *   banned: the banned chess ids the data knows, by tier (ties keep the server's order); perBond: bondId → banned members
 */
export function matchInfoModel(pub, { bonds = [], chess = () => null, mode = null, priv = null, diyData = null } = {}) {
  const sets = disabledBondSets(pub, mode?.inactiveBondIds);
  const stateOf = (id) => (sets.off.has(id) ? 'off' : sets.drawn.has(id) ? 'drawn' : null);
  const list = (Array.isArray(bonds) ? bonds : []).filter((b) => !!b && typeof b === 'object' && typeof b.bondId === 'string')
    .sort((a, b) => (a.bondOrder ?? 0) - (b.bondOrder ?? 0) || (a.identifier ?? 0) - (b.identifier ?? 0));
  const tierOf = (id) => chess(id)?.tier ?? 0;
  const banned = (Array.isArray(pub?.bannedChess) ? pub.bannedChess : []).filter((id) => typeof id === 'string' && !!chess(id))
    .sort((a, b) => tierOf(a) - tierOf(b));
  const regulation = pub?.bondDraw === 'regulation';
  // 规程's official briefing lists only the bonds the mode loads (标准 / 极速 / 规程等级1–4 show 8 core and 10 add-on discs:
  // the mode's fixed inactive list is left out) and puts the lit discs before the greyed ones, each in the usual order
  // (BV11NW869ELq parts 3 / 5 / 10, BV12ZWP6pE7m, BV13LWM6BEvY); 盟约 shows every bond in its order, the fixed ones greyed
  const shown = regulation ? list.filter((b) => stateOf(b.bondId) !== 'off') : list;
  const litFirst = (arr) => (regulation ? [...arr.filter((b) => !stateOf(b.bondId)), ...arr.filter((b) => stateOf(b.bondId))] : arr);
  return {
    regulation, choice: pub?.bondChoice ?? null,
    sets, stateOf, bonds: list, core: litFirst(shown.filter((b) => b.isCore)), addon: litFirst(shown.filter((b) => !b.isCore)),
    banned, perBond: bannedPerBond(list, banned),
    diyBanned: priv && diyData ? diyBannedPieces(priv, chess, diyData) : [],
  };
}

/**
 * The viewer's 自选 pieces out of the shop this match (MatchInfoModel `diyBanned`): one line under 本局禁用干员, or nothing.
 * @param {{ model: MatchInfoModel, class?: string }} props
 */
export function DiyBannedLine({ model, class: cls = 'brief-banned__diy' }) {
  const list = model?.diyBanned || [];
  if (!list.length) return null;
  return html`<p class=${cls} data-testid="diy-banned"><span class="diybanned__tag">${t('自选')}</span>
    ${t(model.regulation ? N_('{names}因本局盟约随机结果无法出现在你的商店') : N_('{names}的盟约本局全部禁用，不会出现在你的商店'), { names: list.map((x) => dn(x.name)) })}</p>`;
}

/**
 * The box beside a bond's tooltip: its banned members (the badge's count), each with avatar, name and bonds (the hovered
 * one highlighted); null when none are banned.
 * @param {any} bond @param {MatchInfoModel} model @param {Set<string>} banned
 */
function BondBannedAside(bond, model, banned) {
  const ids = (Array.isArray(bond.visibleMembers) ? bond.visibleMembers : []).filter((id) => banned.has(id));
  if (!ids.length) return null;
  const nameOf = new Map(model.bonds.map((b) => [b.bondId, b.name]));
  return html`<div class="brief-bantip">
    <div class="brief-bantip__h">${t('本局禁用干员')}</div>
    ${ids.map((id) => {
      const c = data.lookup('chess', id);
      const bonds = (Array.isArray(c?.bonds) ? c.bonds : []).filter((b) => nameOf.has(b));
      return html`<div key=${id} class="brief-bantip__op" data-chess=${id}>
        <${UnitThumb} kind="chess" ownerId=${null} id=${id} size="xs" showTier=${false} />
        <div class="brief-bantip__txt"><b>${c?.name || id}</b>
          <span>${bonds.map((b, i) => html`${i ? ' · ' : ''}<span class=${cx(b === bond.bondId && 'is-this')}>${nameOf.get(b)}</span>`)}</span></div>
      </div>`;
    })}
  </div>`;
}

/**
 * 规程 header: the section title, the legend chip, and a decorative icon pair.
 * [ASSUMED] the pair does nothing (the recordings show it; no control is named). The chip's title is the longer
 * regulation legend, so that sentence stays reachable when the chip ellipsizes.
 * @param {{ title: string }} props
 */
export function RegulationHead({ title }) {
  return html`<h3 class="brief-h reg-h">
    <span class="reg-h__title">${title}</span>
    <span class="reg-chip" title=${t(REGULATION_BOND_LEGEND)}>
      <span class="brief-legend__off" aria-hidden="true"></span>
      <span class="reg-chip__txt">${t(REGULATION_LEGEND_CHIP)}</span>
    </span>
    <span class="reg-htools" aria-hidden="true"><i></i><i></i></span>
  </h3>`;
}

/**
 * One row of bond discs (核心盟约 / 附加盟约): a greyed disc (✕) for a bond in the drawn set D or one the mode never
 * activates, the red badge with its banned members, a red ring on an enabled bond that lost members; the tooltip says
 * which (briefingBondTip). A bond with banned members lists them in a second box beside the tooltip (BondBannedAside).
 * `head`: null keeps this h3; false omits it (a 规程 group panel titles itself once); a vnode replaces the h3.
 * @param {{ title: string, micro: string, bonds: any[], model: MatchInfoModel, onBond?: (id:string)=>void, head?: any }} props
 */
export function MatchBondRow({ title, micro, bonds, model, onBond, head = null }) {
  const m = data.get('assets');
  const banned = new Set(model.banned);
  const heading = head === false ? null : head != null ? head : html`<h3 class="brief-h"><span>${title}</span><${MicroLabel}>${micro}</${MicroLabel}></h3>`;
  return html`<div class="brief-bonds">
    ${heading}
    <div class="brief-bonds__row">
      ${bonds.map((b) => {
        const state = model.stateOf(b.bondId);
        const off = !!state;
        const bannedN = model.perBond.get(b.bondId) || 0;
        return html`<${Tooltip} key=${b.bondId} text=${briefingBondTip(b.name, state, bannedN, model.regulation && b.isCore)}
          aside=${bannedN > 0 ? BondBannedAside(b, model, banned) : null}>
          <div class=${cx('brief-bond', off && 'is-off', state === 'drawn' && 'is-incomplete', !off && bannedN > 0 && 'is-partial')} data-bond=${b.bondId}>
            <${BondDisc} name=${b.name} icon=${bondIconUrl(m, b.bondId)} active=${!off} disabled=${off} tier=${off ? 0 : (b.thresholds?.length || 1)}
              maxTier=${Math.max(1, b.thresholds?.length || 1)} size="md" onClick=${onBond ? () => onBond(b.bondId) : undefined} />
            ${bannedN > 0 ? html`<span class="brief-bond__ban num"><${Icon} name="user" />${bannedN}</span>` : null}
          </div>
        <//>`;
      })}
    </div>
  </div>`;
}

/**
 * A regulation core this match has greyed: the mode never activates it, or the draw left it out (the group that
 * lost, or multi's grey half). Its operators cannot appear. False before a solo pick greys either group, and false
 * for an add-on or for covenant data (`bondDraw` is the season rule, not a bond id).
 * @param {MatchInfoModel|null|undefined} model
 * @param {string|null|undefined} bondId
 */
export function regulationCoreAbsent(model, bondId) {
  if (!model?.regulation || typeof bondId !== 'string') return false;
  const bond = model.bonds.find((b) => b && b.bondId === bondId);
  return !!bond?.isCore && !!model.stateOf(bondId);
}

/**
 * 规程 solo: both groups in one panel under a single 核心盟约 header, side by side when the column is wide enough.
 * [ASSUMED] the choice stays the 激活第 N 组 buttons (a recording may also accept a tap on the panel).
 * @param {{ model: MatchInfoModel, onPick: Function, onBond?: Function, disabled?: boolean, busy?: boolean }} o
 */
function regulationGroupPanels({ model, onPick, onBond, disabled, busy }) {
  const grouped = new Set(model.choice.groups.flat());
  const rest = model.core.filter((b) => !grouped.has(b.bondId));
  return html`<div class="brief-bond-groups reg-panels" data-testid="bond-groups">
    <${RegulationHead} title=${t('核心盟约')} />
    <p class="brief-bond-groups__hint">${t(BOND_GROUP_HINT)}</p>
    ${model.choice.groups.map((ids, idx) => html`<div class="brief-bond-group" key=${idx}>
      <span class="reg-group__n">${t(N_('第 {n} 组'), { n: idx + 1 })}</span>
      <${MatchBondRow} head=${false} title="" micro="CORE BONDS"
        bonds=${ids.map((id) => model.core.find((b) => b.bondId === id)).filter(Boolean)} model=${model} onBond=${onBond} />
      <${Button} variant="primary" disabled=${disabled || busy} loading=${busy} data-testid=${`bond-group-${idx}`}
        onClick=${() => onPick(idx)}>${t(N_('激活第 {n} 组'), { n: idx + 1 })}<//>
    </div>`)}
    ${rest.length ? html`<${MatchBondRow} head=${false} title=${t('核心盟约')} micro="CORE BONDS" bonds=${rest} model=${model} onBond=${onBond} />` : null}
  </div>`;
}

/** Solo regulation's two groups; after the pick, or without a choice, the ordinary core row. `onBond` opens the card from every disc.
 * `panels` is the 规程 briefing only: one header, the groups side by side. Omitted, the markup below is unchanged.
 */
export function MatchBondGroups({ model, onPick, onBond, disabled = false, busy = false, panels = false }) {
  if (!model.choice || model.choice.picked !== null) {
    if (panels) {
      return html`<${MatchBondRow} title=${t('核心盟约')} micro="CORE BONDS" bonds=${model.core} model=${model} onBond=${onBond}
        head=${html`<${RegulationHead} title=${t('核心盟约')} />`} />`;
    }
    return html`<${MatchBondRow} title=${t('核心盟约')} micro="CORE BONDS" bonds=${model.core} model=${model} onBond=${onBond} />`;
  }
  if (panels) return regulationGroupPanels({ model, onPick, onBond, disabled, busy });
  const grouped = new Set(model.choice.groups.flat());
  const rest = model.core.filter(b => !grouped.has(b.bondId));
  return html`<div class="brief-bond-groups" data-testid="bond-groups">
    <p class="brief-bond-groups__hint">${t(BOND_GROUP_HINT)}</p>
    ${model.choice.groups.map((ids, idx) => html`<div class="brief-bond-group" key=${idx}>
      <${MatchBondRow} title=${t(N_('第 {n} 组'), { n: idx + 1 })} micro="CORE BONDS"
        bonds=${ids.map(id => model.core.find(b => b.bondId === id)).filter(Boolean)} model=${model} onBond=${onBond} />
      <${Button} variant="primary" disabled=${disabled || busy} loading=${busy} data-testid=${`bond-group-${idx}`}
        onClick=${() => onPick(idx)}>${t(N_('激活第 {n} 组'), { n: idx + 1 })}<//>
    </div>`)}
    ${rest.length ? html`<${MatchBondRow} title=${t('核心盟约')} micro="CORE BONDS" bonds=${rest} model=${model} onBond=${onBond} />` : null}
  </div>`;
}

/**
 * The legend under the bond rows ("或本模式禁用" only when the mode switches bonds off).
 * @param {{ model: MatchInfoModel }} props
 */
export function MatchLegend({ model }) {
  return html`<p class="brief-legend"><span class="brief-legend__off"></span>${t(model.regulation ? REGULATION_BOND_LEGEND : N_('灰色：部分盟约所含干员阵容不完整（仍可通过其他盟约的干员或装备激活）'))}${model.sets.off.size ? t('，或本模式禁用') : ''} · <span class="brief-legend__ban"><${Icon} name="user" /></span>${t('该盟约中无法出现的干员数')}</p>`;
}

/**
 * 本局禁用干员: the count and the greyed avatars by tier.
 * @param {{ model: MatchInfoModel }} props
 */
export function BannedOperators({ model }) {
  const { banned } = model;
  return html`<div class="brief-banned">
    <h3 class="brief-h"><span>${t('本局禁用干员')}</span><${MicroLabel}>BANNED OPERATORS</${MicroLabel}><b class="num brief-banned__n">${banned.length}</b></h3>
    ${banned.length ? html`<div class="brief-banned__grid">
      ${banned.map((id) => html`<${UnitThumb} key=${id} kind="chess" ownerId=${null} id=${id} size="sm" dim=${true} />`)}
    </div>` : html`<p class="t-dim">${t('本局没有禁用干员')}</p>`}
    <${DiyBannedLine} model=${model} />
  </div>`;
}

/**
 * 规程 本局禁用干员: each bond that lost members, then those operators (tier order of `model.banned`).
 * [ASSUMED] an operator of two such bonds is listed under each. Ids in no bond's visibleMembers stay, with no invented header.
 * The flat BannedOperators grid is unchanged (the draft dialog and every other version).
 * @param {{ model: MatchInfoModel, onBond?: (id:string)=>void }} props
 */
export function BannedByBond({ model, onBond }) {
  const banned = model?.banned || [];
  const order = new Map(banned.map((id, i) => [id, i]));
  const claimed = new Set();
  const groups = [];
  for (const bond of [...(model?.core || []), ...(model?.addon || [])]) {
    const members = (Array.isArray(bond.visibleMembers) ? bond.visibleMembers : [])
      .filter((id) => order.has(id))
      .sort((a, b) => order.get(a) - order.get(b));
    if (!members.length) continue;
    for (const id of members) claimed.add(id);
    groups.push({ bond, members });
  }
  const rest = banned.filter((id) => !claimed.has(id));
  const m = data.get('assets');
  return html`<div class="brief-banned reg-banned">
    <${RegulationHead} title=${t('本局禁用干员')} />
    ${banned.length ? html`<div class="reg-banned__groups">
      ${groups.map(({ bond, members }) => {
        const state = model.stateOf(bond.bondId);
        const off = !!state;
        const bannedN = model.perBond.get(bond.bondId) || 0;
        return html`<div class="reg-banned__group" key=${bond.bondId} data-bond=${bond.bondId}>
          <${Tooltip} text=${briefingBondTip(bond.name, state, bannedN, model.regulation && bond.isCore)}>
            <div class="reg-banned__disc">
              <${BondDisc} name=${bond.name} icon=${bondIconUrl(m, bond.bondId)} active=${!off} disabled=${off}
                tier=${off ? 0 : (bond.thresholds?.length || 1)} maxTier=${Math.max(1, bond.thresholds?.length || 1)}
                size="md" onClick=${onBond ? () => onBond(bond.bondId) : undefined} />
            </div>
          <//>
          <div class="reg-banned__ops">
            ${members.map((id) => html`<${UnitThumb} key=${bond.bondId + ':' + id} kind="chess" ownerId=${null} id=${id} size="sm" dim=${true} />`)}
          </div>
        </div>`;
      })}
      ${rest.length ? html`<div class="reg-banned__rest" data-testid="banned-rest">
        ${rest.map((id) => html`<${UnitThumb} key=${id} kind="chess" ownerId=${null} id=${id} size="sm" dim=${true} />`)}
      </div>` : null}
    </div>` : html`<p class="t-dim">${t('本局没有禁用干员')}</p>`}
    <${DiyBannedLine} model=${model} />
  </div>`;
}

/**
 * The briefing's bonds and banned operators: 核心盟约, 附加盟约, the legend, 本局禁用干员.
 * @param {{ model: MatchInfoModel, onBond?: (id:string)=>void }} props
 */
export function MatchInfo({ model, onBond }) {
  return html`<${MatchBondRow} title=${t('核心盟约')} micro="CORE BONDS" bonds=${model.core} model=${model} onBond=${onBond} />
    <${MatchBondRow} title=${t('附加盟约')} micro="ADD-ON BONDS" bonds=${model.addon} model=${model} onBond=${onBond} />
    <${MatchLegend} model=${model} />
    <${BannedOperators} model=${model} />`;
}

/**
 * The read-only match-info dialog (the strategy draft's 本局信息): MatchInfo in a Modal that 关闭, a tap outside or Esc
 * closes. `enemies` is the shared briefing enemy block; `status` (e.g. the draft's turn and countdown) sits left of 关闭.
 * @param {{ open: boolean, onClose: Function, model: MatchInfoModel|null, enemies?: any, status?: any, onBond?: (id:string)=>void }} props
 */
export function MatchInfoDialog({ open, onClose, model, enemies = null, status = null, onBond }) {
  return html`<${Modal} open=${open && !!model} onClose=${onClose} title=${t('本局信息')} micro="MATCH INFO" class="minfo-dlg"
    actions=${html`${status ? html`<div class="minfo-dlg__status" data-testid="match-info-status">${status}</div>` : null}
      <${Button} variant="secondary" icon="close" data-autofocus data-testid="match-info-close" onClick=${onClose}>${t('关闭')}<//>`}>
    ${open && model ? html`<div class=${cx('minfo-dlg__content', enemies && 'has-enemies')}>
      ${enemies ? html`<section class="minfo-dlg__enemies">${enemies}</section>` : null}
      <section class="minfo-dlg__bonds"><${MatchInfo} model=${model} onBond=${onBond} /></section>
    </div>` : null}
  <//>`;
}

/** The existing bond card above match information, with nested Escape/focus handling (#915).
 * Preparation callers omit onMember: the member grid stays informational until the battle detail panel is available.
 * @param {{ bondId: string|null, onClose: Function, entry?: any, priv?: any, banned?: string[], off?: boolean,
 *   owner?: string|null, ownerId?: string|null, morphMode?: string, onMember?: (id:string, items?:string[]|null, standInFor?:string|null, diy?:any)=>void }} props
 */
export function MatchBondDialog({ bondId, onClose, ...props }) {
  const box = useRef(null);
  useModalFocus(!!bondId, onClose, box);
  if (!bondId) return null;
  return html`<div class="modal match-bond-modal" role="presentation"
    onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref=${box} class="match-bond-dialog" tabindex="-1">
      <${BondPopup} bondId=${bondId} onClose=${onClose} modal=${true} ...${props} />
    </div>
  </div>`;
}
