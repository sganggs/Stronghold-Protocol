// 本局信息 dialog under the top bar (opened by the left 🔍, official btn_check_player / autochess_hud_player_info_dialog,
// research 09 §2.1) with two tabs:
//   本局信息 — own strategy, stage, disabled bonds with banned-member counts and the banned operator list (default) —
//              the same bonds, states and banned operators (by tier) as the briefing and the strategy draft's 本局信息
//              dialog: ui/matchInfo.js matchInfoModel, drawn here as compact chips and avatars;
//   敌方情报 — the secondary enemy list: m.private.nextEnemies (icons, names, counts, tags, 特训 faction tags) + this
//              match's factions and the enemy leader on boss rounds. The primary enemy preview is the pen on the board
//              (the right 🔍▶▶ pans the camera there; tapping an enemy in the pen opens its detail card) — research 09 §6.2.

import { html, Icon, Tabs, MicroLabel } from './components.js';
import { Img, UnitThumb, BondGlyph, BandIcon, RichText, GIcon } from './gameComponents.js';
import { groupEnemies, factionTypes, briefingBondTip } from './gameLogic.js';
import { matchInfoModel, DiyBannedLine } from './matchInfo.js';
import { factionIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const TAG = { boss: N_('领袖'), bounty: N_('悬赏'), escort: N_('护卫') };

function FactionChips({ types }) {
  const f = data.get('factions')?.types || {};
  const m = data.get('assets');
  return html`<div class="fchips">${types.map((t) => html`<span key=${t} class="fchip" title=${f[t]?.desc || ''}>
    <${Img} src=${factionIconUrl(m, f[t]?.icon)} class="fchip__icon" /><span>${f[t]?.name || t}</span></span>`)}</div>`;
}

function EnemiesTab({ pub, priv, onEnemy }) {
  const rows = groupEnemies(priv?.nextEnemies, (k) => data.lookup('enemies', k));
  const types = factionTypes(pub?.factions);
  const f = data.get('factions')?.types || {};
  const total = rows.reduce((s, r) => s + r.count, 0);
  const boss = pub?.bossId ? data.lookup('bosses', pub.bossId) : null;
  return html`<div class="edrawer__body">
    <div class="edrawer__sum">
      <span>${tParts('第 {r} 回合 · 即将迎击 {n} 名敌人', { r: html`<b class="num">${pub?.round ?? '-'}</b>`, n: html`<b class="num t-orange">${total}</b>`, count: total })}</span>
      ${types.length ? html`<${FactionChips} types=${types} />` : null}
    </div>
    ${rows.length ? html`<div class="elist">
      ${rows.map((r) => html`<button key=${`${r.enemyKey}|${r.tag}`} type="button" class=${cx('erow', r.tag && `erow--${r.tag}`, `erow--${r.rank.toLowerCase()}`)}
          onClick=${() => onEnemy(r.enemyKey, r.count)}>
        <${UnitThumb} kind="enemy" id=${r.enemyKey} size="md" />
        <span class="erow__text">
          <b class="erow__name">${r.name}</b>
          <span class="erow__tags">
            ${r.tag ? html`<span class=${`etag etag--${r.tag}`}>${t(TAG[r.tag] || r.tag)}</span>` : null}
            ${r.rank === 'ELITE' ? html`<span class="etag etag--elite">${t('精英')}</span>` : null}
            ${r.fly ? html`<span class="etag etag--fly">${t('空中')}</span>` : null}
            ${r.acTypes.map((ty) => html`<span key=${ty} class="etag etag--faction">${(f[ty]?.name || ty).replace(t('特训敌人·'), '')}</span>`)}
          </span>
        </span>
        <b class="erow__count num">×${r.count}</b>
      </button>`)}
    </div>` : html`<p class="edrawer__empty"><${GIcon} name="target" />${t('暂无敌方情报')}</p>`}
    ${boss ? html`<div class="eboss">
      <${UnitThumb} kind="enemy" id=${boss.enemyKey} size="md" />
      <div><${MicroLabel} tone="gold">${t('ENEMY LEADER // 敌方领袖')}</${MicroLabel}><b>${boss.name}</b>
        <span class="t-lo">${t('第 {r} 回合 · 最终攻势', { r: data.get('config')?.modes?.[pub.modeId]?.bossRound ?? pub.lastRound ?? 14 })}</span></div>
    </div>` : null}
  </div>`;
}

function InfoTab({ pub, priv, onChess, bandId = null, bandOwner = null }) {
  const model = matchInfoModel(pub, {
    bonds: data.list('bonds'), chess: (id) => data.lookup('chess', id), mode: data.get('config')?.modes?.[pub?.modeId],
    // the own 自选 pieces this match leaves out of the shop (m.private.diyBanned) — not while scouting a teammate
    priv: bandOwner ? null : priv, diyData: { chess: data.get('chess'), backups: data.get('backups') },
  });
  const { bonds, banned, perBond, stateOf } = model;
  const disabled = new Set(bonds.filter((b) => stateOf(b.bondId)).map((b) => b.bondId));
  // while scouting a teammate's prep board the drawer shows THEIR 策略 in place of one's own (user playtest #2 item 2)
  const band = (bandId || priv?.bandId) ? data.lookup('bands', bandId || priv.bandId) : null;
  const stage = pub?.stageId ? data.lookup('stages', pub.stageId) : null;
  const withBans = bonds.filter((b) => disabled.has(b.bondId) || (perBond.get(b.bondId) || 0) > 0)
    .sort((a, b) => (disabled.has(b.bondId) - disabled.has(a.bondId)) || ((perBond.get(b.bondId) || 0) - (perBond.get(a.bondId) || 0)));
  return html`<div class="edrawer__body">
    ${band ? html`<div class="iband">
      <${BandIcon} bandId=${band.bandId} size="md" />
      <div><${MicroLabel} tone="mint">STRATEGY // ${bandOwner ? t('{bandOwner} 的策略', { bandOwner }) : t('我的策略')}</${MicroLabel}><b>${band.name} <small class="t-lo">${band.effectName}</small></b>
        <${RichText} text=${band.descRaw || band.desc} class="iband__desc" /></div>
    </div>` : null}
    ${stage ? html`<p class="istage"><${Icon} name="rook" />${t('战场：')}<b>${stage.name || stage.id}</b></p>` : null}
    <h4 class="ihead">${t('本局禁用干员情况')} <small class="num">${banned.length}</small></h4>
    <div class="ibonds">
      ${withBans.length ? withBans.map((b) => html`<span key=${b.bondId} class=${cx('ibond', disabled.has(b.bondId) && 'is-off')} title=${briefingBondTip(b.name, stateOf(b.bondId), perBond.get(b.bondId) || 0)}>
        <${BondGlyph} bondId=${b.bondId} /><span>${b.name}</span>
        ${perBond.get(b.bondId) ? html`<span class="ibond__ban num" title=${t('该盟约中被禁用的干员数')}><${Icon} name="user" />${perBond.get(b.bondId)}</span>` : null}
      </span>`) : html`<span class="t-dim">${t('本局没有禁用盟约')}</span>`}
    </div>
    ${banned.length ? html`<div class="ibanned">${banned.map((id) => html`<button key=${id} type="button" class="ibanned__one" onClick=${() => onChess(id)}>
      <${UnitThumb} kind="chess" id=${id} size="sm" dim=${true} /></button>`)}</div>` : null}
    <${DiyBannedLine} model=${model} class="idiybanned" />
  </div>`;
}

/**
 * @param {{ tab:'enemies'|'info', onTab:(t:string)=>void, pub:any, priv:any, onClose:Function, onEnemy:(key:string, count:number)=>void, onChess:(id:string)=>void,
 *   bandId?: string|null, bandOwner?: string|null }} props
 *   bandId / bandOwner: while scouting a teammate's prep board, the watched player's 策略 (m.public players[].bandId)
 *   replaces one's own in the 本局信息 tab (game.js scoutBandId; user playtest #2 item 2)
 */
export function EnemyDrawer({ tab, onTab, pub, priv, onClose, onEnemy, onChess, bandId = null, bandOwner = null, closing = false }) {
  return html`<div class=${`edrawer brackets${closing ? ' is-closing' : ''}`} role="dialog" aria-label=${tab === 'info' ? t('本局信息') : t('敌方情报')}>
    <div class="edrawer__top">
      <${Tabs} size="sm" value=${tab} onChange=${onTab} items=${[{ id: 'info', label: t('本局信息') }, { id: 'enemies', label: t('敌方情报') }]} />
      <button type="button" class="edrawer__close tapx" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </div>
    ${tab === 'info' ? html`<${InfoTab} pub=${pub} priv=${priv} onChess=${onChess} bandId=${bandId} bandOwner=${bandOwner} />` : html`<${EnemiesTab} pub=${pub} priv=${priv} onEnemy=${onEnemy} />`}
  </div>`;
}
