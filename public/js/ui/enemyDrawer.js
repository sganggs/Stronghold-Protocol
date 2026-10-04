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
import { matchInfoModel } from './matchInfo.js';
import { factionIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { T } from '../i18n.js';
const cx = (...p) => p.flat().filter(Boolean).join(' ');
const TAG = { boss: T('领袖'), bounty: T('悬赏'), escort: T('护卫') };
// a faction's tag on an enemy row: its name without the "特训敌人·" prefix (the data names are already in the display
// language, so the English "Tactical Training Enemy/" form is dropped too)
const factionTag = (name) => String(name).replace(/^(特训敌人·|Tactical Training( Enemy)?\s*[·:/-]\s*)/, ''); // i18n-ok: data prefix match

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
      <span>${T('第')} <b class="num">${pub?.round ?? '-'}</b> ${T('回合 · 即将迎击')} <b class="num t-orange">${total}</b> ${T('名敌人')}</span>
      ${types.length ? html`<${FactionChips} types=${types} />` : null}
    </div>
    ${rows.length ? html`<div class="elist">
      ${rows.map((r) => html`<button key=${`${r.enemyKey}|${r.tag}`} type="button" class=${cx('erow', r.tag && `erow--${r.tag}`, `erow--${r.rank.toLowerCase()}`)}
          onClick=${() => onEnemy(r.enemyKey, r.count)}>
        <${UnitThumb} kind="enemy" id=${r.enemyKey} size="md" />
        <span class="erow__text">
          <b class="erow__name">${r.name}</b>
          <span class="erow__tags">
            ${r.tag ? html`<span class=${`etag etag--${r.tag}`}>${TAG[r.tag] || r.tag}</span>` : null}
            ${r.rank === 'ELITE' ? html`<span class="etag etag--elite">${T('精英')}</span>` : null}
            ${r.fly ? html`<span class="etag etag--fly">${T('空中')}</span>` : null}
            ${r.acTypes.map((t) => html`<span key=${t} class="etag etag--faction">${factionTag(f[t]?.name || t)}</span>`)}
          </span>
        </span>
        <b class="erow__count num">×${r.count}</b>
      </button>`)}
    </div>` : html`<p class="edrawer__empty"><${GIcon} name="target" />${T('暂无敌方情报')}</p>`}
    ${boss ? html`<div class="eboss">
      <${UnitThumb} kind="enemy" id=${boss.enemyKey} size="md" />
      <div><${MicroLabel} tone="gold">ENEMY LEADER // ${T('敌方领袖')}</${MicroLabel}><b>${boss.name}</b>
        <span class="t-lo">${T('第 {0} 回合 · 最终攻势', data.get('config')?.modes?.[pub.modeId]?.bossRound ?? pub.lastRound ?? 14)}</span></div>
    </div>` : null}
  </div>`;
}

function InfoTab({ pub, priv, onChess }) {
  const { bonds, banned, perBond, stateOf } = matchInfoModel(pub, {
    bonds: data.list('bonds'), chess: (id) => data.lookup('chess', id), mode: data.get('config')?.modes?.[pub?.modeId],
  });
  const disabled = new Set(bonds.filter((b) => stateOf(b.bondId)).map((b) => b.bondId));
  const band = priv?.bandId ? data.lookup('bands', priv.bandId) : null;
  const stage = pub?.stageId ? data.lookup('stages', pub.stageId) : null;
  const withBans = bonds.filter((b) => disabled.has(b.bondId) || (perBond.get(b.bondId) || 0) > 0)
    .sort((a, b) => (disabled.has(b.bondId) - disabled.has(a.bondId)) || ((perBond.get(b.bondId) || 0) - (perBond.get(a.bondId) || 0)));
  return html`<div class="edrawer__body">
    ${band ? html`<div class="iband">
      <${BandIcon} bandId=${band.bandId} size="md" />
      <div><${MicroLabel} tone="mint">STRATEGY // ${T('我的策略')}</${MicroLabel}><b>${band.name} <small class="t-lo">${band.effectName}</small></b>
        <${RichText} text=${band.descRaw || band.desc} class="iband__desc" /></div>
    </div>` : null}
    ${stage ? html`<p class="istage"><${Icon} name="rook" />${T('战场：')} <b>${stage.name || stage.id}</b></p>` : null}
    <h4 class="ihead">${T('本局禁用干员情况')} <small class="num">${banned.length}</small></h4>
    <div class="ibonds">
      ${withBans.length ? withBans.map((b) => html`<span key=${b.bondId} class=${cx('ibond', disabled.has(b.bondId) && 'is-off')} title=${briefingBondTip(b.name, stateOf(b.bondId), perBond.get(b.bondId) || 0)}>
        <${BondGlyph} bondId=${b.bondId} /><span>${b.name}</span>
        ${perBond.get(b.bondId) ? html`<span class="ibond__ban num" title=${T('该盟约中被禁用的干员数')}><${Icon} name="user" />${perBond.get(b.bondId)}</span>` : null}
      </span>`) : html`<span class="t-dim">${T('本局没有禁用盟约')}</span>`}
    </div>
    ${banned.length ? html`<div class="ibanned">${banned.map((id) => html`<button key=${id} type="button" class="ibanned__one" onClick=${() => onChess(id)}>
      <${UnitThumb} kind="chess" id=${id} size="sm" dim=${true} /></button>`)}</div>` : null}
  </div>`;
}

/**
 * @param {{ tab:'enemies'|'info', onTab:(t:string)=>void, pub:any, priv:any, onClose:Function, onEnemy:(key:string, count:number)=>void, onChess:(id:string)=>void }} props
 */
export function EnemyDrawer({ tab, onTab, pub, priv, onClose, onEnemy, onChess }) {
  return html`<div class="edrawer brackets" role="dialog" aria-label=${tab === 'info' ? T('本局信息') : T('敌方情报')}>
    <div class="edrawer__top">
      <${Tabs} size="sm" value=${tab} onChange=${onTab} items=${[{ id: 'info', label: T('本局信息') }, { id: 'enemies', label: T('敌方情报') }]} />
      <button type="button" class="edrawer__close tapx" aria-label=${T('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </div>
    ${tab === 'info' ? html`<${InfoTab} pub=${pub} priv=${priv} onChess=${onChess} />` : html`<${EnemiesTab} pub=${pub} priv=${priv} onEnemy=${onEnemy} />`}
  </div>`;
}
