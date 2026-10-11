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
// greyed with the ✕, the red banned-member badge, the briefingBondTip tooltip — the legend and the 本局禁用干员 rows.
// MatchInfoDialog shows the same blocks read-only in a components.js Modal (关闭, a tap outside or Esc close it) with a
// status line from its caller (the draft's turn and countdown, so the running clock stays in view).
// Styles: css/screens/briefing.css (.brief-*), css/screens/draft.css (.minfo-dlg).

import { html, Button, Icon, MicroLabel, BondDisc, Tooltip, Modal } from './components.js';
import { UnitThumb } from './gameComponents.js';
import { bannedPerBond, disabledBondSets, briefingBondTip, diyBannedPieces } from './gameLogic.js';
import { bondIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t, dn } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * @typedef {{ sets: { drawn: Set<string>, off: Set<string> }, stateOf: (bondId: string) => 'off'|'drawn'|null,
 *   bonds: any[], core: any[], addon: any[], banned: string[], perBond: Map<string, number>,
 *   bannedGroups: Array<{ bond: any, ids: string[] }>, ungroupedBanned: string[],
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
 *   banned: unique known chess ids, by tier (ties keep server order); perBond: bondId → banned members;
 *   bannedGroups: nonempty alliance/member rows in briefing order; ungroupedBanned: known ids without a membership record
 */
export function matchInfoModel(pub, { bonds = [], chess = () => null, mode = null, priv = null, diyData = null } = {}) {
  const sets = disabledBondSets(pub, mode?.inactiveBondIds);
  const stateOf = (id) => (sets.off.has(id) ? 'off' : sets.drawn.has(id) ? 'drawn' : null);
  const list = (Array.isArray(bonds) ? bonds : []).filter((b) => !!b && typeof b === 'object' && typeof b.bondId === 'string')
    .sort((a, b) => (a.bondOrder ?? 0) - (b.bondOrder ?? 0) || (a.identifier ?? 0) - (b.identifier ?? 0));
  const tierOf = (id) => chess(id)?.tier ?? 0;
  const banned = [...new Set(Array.isArray(pub?.bannedChess) ? pub.bannedChess : [])].filter((id) => typeof id === 'string' && !!chess(id))
    .sort((a, b) => tierOf(a) - tierOf(b));
  // Official briefing: alliance left, banned members right, higher tiers first (official intro: 坚守 shows V before I).
  // [ASSUMED] A multi-alliance operator appears in each relevant row; the heading still counts unique operators. The public ban
  // list is authoritative: an incomplete alliance does not make all its members unavailable.
  const bannedGroups = list.map((bond) => {
    const members = new Set(Array.isArray(bond.visibleMembers) ? bond.visibleMembers : []);
    return { bond, ids: banned.filter((id) => members.has(id)).sort((a, b) => tierOf(b) - tierOf(a)) };
  }).filter((g) => g.ids.length);
  const grouped = new Set(bannedGroups.flatMap((g) => g.ids));
  return {
    sets, stateOf, bonds: list, core: list.filter((b) => b.isCore), addon: list.filter((b) => !b.isCore),
    banned, perBond: bannedPerBond(list, banned), bannedGroups, ungroupedBanned: banned.filter((id) => !grouped.has(id)),
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
    ${t('{names}的盟约本局全部禁用，不会出现在你的商店', { names: list.map((x) => dn(x.name)) })}</p>`;
}

/**
 * One row of bond discs (核心盟约 / 附加盟约): a greyed disc (✕) for a bond in the drawn set D or one the mode never
 * activates, the red badge with its banned members, a red ring on an enabled bond that lost members; the tooltip says
 * which (briefingBondTip).
 * @param {{ title: string, micro: string, bonds: any[], model: MatchInfoModel }} props
 */
export function MatchBondRow({ title, micro, bonds, model }) {
  const m = data.get('assets');
  return html`<div class="brief-bonds">
    <h3 class="brief-h"><span>${title}</span><${MicroLabel}>${micro}</${MicroLabel}></h3>
    <div class="brief-bonds__row">
      ${bonds.map((b) => {
        const state = model.stateOf(b.bondId);
        const off = !!state;
        const bannedN = model.perBond.get(b.bondId) || 0;
        return html`<${Tooltip} key=${b.bondId} text=${briefingBondTip(b.name, state, bannedN)}>
          <div class=${cx('brief-bond', off && 'is-off', state === 'drawn' && 'is-incomplete', !off && bannedN > 0 && 'is-partial')} data-bond=${b.bondId}>
            <${BondDisc} name=${b.name} icon=${bondIconUrl(m, b.bondId)} active=${!off} disabled=${off} tier=${off ? 0 : (b.thresholds?.length || 1)}
              maxTier=${Math.max(1, b.thresholds?.length || 1)} size="md" />
            ${bannedN > 0 ? html`<span class="brief-bond__ban num"><${Icon} name="user" />${bannedN}</span>` : null}
          </div>
        <//>`;
      })}
    </div>
  </div>`;
}

/**
 * The legend under the bond rows ("或本模式禁用" only when the mode switches bonds off).
 * @param {{ model: MatchInfoModel }} props
 */
export function MatchLegend({ model }) {
  return html`<p class="brief-legend"><span class="brief-legend__off"></span>${t('灰色：部分盟约所含干员阵容不完整（仍可通过其他盟约的干员或装备激活）')}${model.sets.off.size ? t('，或本模式禁用') : ''} · <span class="brief-legend__ban"><${Icon} name="user" /></span>${t('该盟约中无法出现的干员数')}</p>`;
}

/**
 * Official alliance/member rows, using only the existing alliance icons and operator thumbnails. In-game callers can
 * open an operator's detail card; pre-game callers are read-only. Unknown alliance memberships retain their portraits.
 * @param {{ model: MatchInfoModel, onChess?: (id: string) => void }} props
 */
export function BannedAllianceRows({ model, onChess }) {
  const m = data.get('assets');
  const groups = [...model.bannedGroups];
  if (model.ungroupedBanned.length) groups.push({ bond: null, ids: model.ungroupedBanned });
  return html`<div class="brief-banned__rows">
    ${groups.map(({ bond, ids }) => {
      const name = bond?.name || t('本局禁用干员');
      const disabled = bond ? !!model.stateOf(bond.bondId) : false;
      return html`<div key=${bond?.bondId || 'ungrouped'} class="brief-banned__row" data-banned-bond=${bond?.bondId || 'ungrouped'} role="group" aria-label=${name}>
        <div class="brief-banned__bond">
          ${bond ? html`<${BondDisc} name=${name} icon=${bondIconUrl(m, bond.bondId)} active=${!disabled} disabled=${disabled} size="sm" />`
            : html`<span class="t-dim">${name}</span>`}
        </div>
        <div class="brief-banned__grid">
          ${ids.map((id) => {
            const Tag = onChess ? 'button' : 'span';
            const name = data.lookup('chess', id)?.name || id;
            return html`<${Tag} key=${id} class="brief-banned__operator" data-banned-chess=${id}
                type=${onChess ? 'button' : undefined} aria-label=${onChess ? name : undefined} onClick=${onChess ? () => onChess(id) : undefined}>
              <${UnitThumb} kind="chess" id=${id} size="sm" dim=${true} showTier=${true}
                badge=${html`<span class="brief-banned__mark" aria-label=${t('禁用')}><${Icon} name="close" /></span>`} />
            <//>`;
          })}
        </div>
      </div>`;
    })}
  </div>`;
}

/**
 * 本局禁用干员: the unique count and greyed avatars grouped by alliance, in tier order within each row.
 * @param {{ model: MatchInfoModel }} props
 */
export function BannedOperators({ model }) {
  const { banned } = model;
  return html`<div class="brief-banned">
    <h3 class="brief-h"><span>${t('本局禁用干员')}</span><${MicroLabel}>BANNED OPERATORS</${MicroLabel}><b class="num brief-banned__n">${banned.length}</b></h3>
    ${banned.length ? html`<${BannedAllianceRows} model=${model} />` : html`<p class="t-dim">${t('本局没有禁用干员')}</p>`}
    <${DiyBannedLine} model=${model} />
  </div>`;
}

/**
 * The briefing's bonds and banned operators: 核心盟约, 附加盟约, the legend, 本局禁用干员.
 * @param {{ model: MatchInfoModel }} props
 */
export function MatchInfo({ model }) {
  return html`<${MatchBondRow} title=${t('核心盟约')} micro="CORE BONDS" bonds=${model.core} model=${model} />
    <${MatchBondRow} title=${t('附加盟约')} micro="ADD-ON BONDS" bonds=${model.addon} model=${model} />
    <${MatchLegend} model=${model} />
    <${BannedOperators} model=${model} />`;
}

/**
 * The read-only match-info dialog (the strategy draft's 本局信息): MatchInfo in a Modal that 关闭, a tap outside or Esc
 * closes. `status` (the caller's line, e.g. the draft's turn and countdown) sits left of 关闭.
 * @param {{ open: boolean, onClose: Function, model: MatchInfoModel|null, status?: any }} props
 */
export function MatchInfoDialog({ open, onClose, model, status = null }) {
  return html`<${Modal} open=${open && !!model} onClose=${onClose} title=${t('本局信息')} micro="MATCH INFO // BONDS & BANNED OPERATORS" class="minfo-dlg"
    actions=${html`${status ? html`<div class="minfo-dlg__status" data-testid="match-info-status">${status}</div>` : null}
      <${Button} variant="secondary" icon="close" data-autofocus data-testid="match-info-close" onClick=${onClose}>${t('关闭')}<//>`}>
    ${open && model ? html`<${MatchInfo} model=${model} />` : null}
  <//>`;
}
