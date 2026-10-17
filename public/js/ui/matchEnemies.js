// Shared briefing and strategy-draft enemy information (GitHub #484): only the match's announced leader,
// battlefield and special enemy types. Read the current localized data; no gameplay actions or round previews.

import { html, Icon, MicroLabel } from './components.js';
import { Img, RichText } from './gameComponents.js';
import { factionTypes } from './gameLogic.js';
import { enemyIconUrl, factionIconUrl } from './assetUrls.js';
import { t, tParts } from '../../../shared/i18n.js';

/**
 * The briefing's left column, also shown in the strategy draft's 本局信息 dialog.
 * @param {{ pub: any, gd: ReturnType<typeof import('./gameComponents.js').makeLookups> }} props
 */
export function MatchEnemies({ pub, gd }) {
  if (!pub) return null;
  const mode = gd.config?.modes?.[pub.modeId];
  const boss = pub.bossId ? gd.boss(pub.bossId) : null;
  const bossEnemy = boss ? gd.enemy(boss.enemyKey) : null;
  const stage = pub.stageId ? gd.stage(pub.stageId) : null;
  const poolN = Array.isArray(mode?.stages) ? mode.stages.length : 0;
  const pool = poolN > 1 ? t('战场随机（共{poolN}张）', { poolN }) : poolN === 1 ? t('战场固定') : '';
  const types = factionTypes(pub.factions);
  const factions = gd.factions?.types || {};
  const m = gd.m;

  return html`<div class="brief-boss brackets">
      <${MicroLabel} tone="gold">${t('ENEMY LEADER // 敌方领袖')}</${MicroLabel}>
      <div class="brief-boss__art">
        <div class="brief-boss__ring" aria-hidden="true"></div>
        ${bossEnemy ? html`<${Img} src=${enemyIconUrl(m, boss.enemyKey)} class="brief-boss__sil" fallback=${html`<span class="brief-boss__q">?</span>`} />`
          : html`<span class="brief-boss__q">?</span>`}
      </div>
      <div class="brief-boss__text">
        <h2 class="brief-boss__name">${boss?.name || bossEnemy?.name || t('未知领袖')}</h2>
        <span class="brief-boss__when">${tParts('第 {r} 回合 · 最终攻势', { r: html`<b class="num">${mode?.bossRound ?? pub.lastRound ?? 14}</b>` })}</span>
        ${Array.isArray(boss?.abilities) && boss.abilities.length ? html`<ul class="brief-boss__abil">
          ${boss.abilities.slice(0, 3).map((a, i) => html`<li key=${i}><${RichText} text=${a} /></li>`)}
        </ul>` : null}
      </div>
    </div>
    <div class="brief-stage">
      <span class="brief-stage__k"><${MicroLabel}>BATTLEFIELD</${MicroLabel}>${pool ? html`<span class="brief-stage__pool">${pool}</span>` : null}</span>
      <span class="brief-stage__name"><${Icon} name="rook" />${stage?.name || pub.stageId || '—'}</span>
    </div>
    <div class="brief-factions">
      <h3 class="brief-h"><span>${t('特训敌人')}</span><${MicroLabel}>SPECIAL ENEMIES</${MicroLabel}></h3>
      ${types.length ? types.map((type) => html`<div key=${type} class="brief-faction" data-faction=${type}>
        <span class="brief-faction__icon"><${Img} src=${factionIconUrl(m, factions[type]?.icon)} /></span>
        <span class="brief-faction__text"><b>${factions[type]?.name || type}</b><span>${factions[type]?.desc || ''}</span></span>
      </div>`) : html`<p class="t-dim">${t('本局没有特训敌人')}</p>`}
    </div>`;
}
