// Shared briefing and strategy-draft enemy information (GitHub #484, DESIGN §35.6): only the match's announced leader,
// battlefield and special enemy types. Read the current localized data; no gameplay actions or round previews.
// The event's 本局遭遇敌方 layout (PR #643, video 6:29–7:51): the leader's framed portrait over 敌方领袖, its text — name,
// final-assault round, abilities, the battlefield — and the 特训敌人 as round icons with their names.
// The 特训敌人 description — the maintainer's decision of 2026-10-22 (decision 8 of 2026-10-21, variant (b), PR #828's):
// the name under each icon, the description in a Tooltip on hover, keyboard focus (the icon is focusable) and a long press
// (≥ 450 ms) on touch; for screen readers the icon names the type and points at the description (aria-describedby an
// .sr-only copy). The tooltip points at the icon, not at the cell (in the dialog a cell is a whole row, and the box
// centred over it sat far from the icon, over the 战场 line — §35.18's leftover): above it, or below when it does not
// fit there or would cover the leader block (portrait and text), inside the dialog and the screen (components.js
// placeTooltip). [ASSUMED] no official screenshot of INFO_CHECK's 特训敌人 is in the repo; the placement rule.
// One copy for both screens: the briefing's .brief-sec--enemy (css/screens/briefing.css, scoped under .brief) and the
// draft's 本局信息 dialog (screens/bandDraft.js → ui/matchInfo.js MatchInfoDialog; css/screens/draft.css .minfo-dlg
// stacks the same markup into its narrower column).

import { html, Icon, MicroLabel, Tooltip } from './components.js';
import { Img, RichText } from './gameComponents.js';
import { factionTypes } from './gameLogic.js';
import { enemyIconUrl, factionIconUrl } from './assetUrls.js';
import { t, tParts } from '../../../shared/i18n.js';

/**
 * The id of a 特训敌人 type's description (its icon's aria-describedby): `scope` keeps the briefing's and the draft
 * dialog's apart should both ever be in the page.
 * @param {string} scope
 * @param {string} type
 */
export const factionDescId = (scope, type) => `${scope}-fdesc-${String(type).replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** What a 特训敌人 tooltip keeps clear of: the leader block — the portrait with its tag, and each line of its text. */
export const leaderBlockOf = (el) => el.closest('.brief-enemy')?.querySelectorAll('.brief-boss, .brief-boss__text > *') || [];

/** A faction's name with a break opportunity after each '/' (「特训敌人/飞行」: English 「Tactical Training/Flying」 broke
 * inside 「Flying」, a slash between letters giving none — §35.51 review); its text and accessible name unchanged. */
const slashBreaks = (s) => String(s).split('/').flatMap((part, i) => (i ? [html`/<wbr />`, part] : [part]));

/** Round, abilities and battlefield for the 规程 leader: the tooltip, and an .sr-only copy on the button. */
function leaderDetails({ mode, pub, boss, stage, pool }) {
  const when = tParts('第 {r} 回合 · 最终攻势', { r: html`<b class="num">${mode?.bossRound ?? pub.lastRound ?? 14}</b>` });
  const abilities = Array.isArray(boss?.abilities) ? boss.abilities.slice(0, 3) : [];
  return html`<div class="reg-boss__tipbody">
    <span class="brief-boss__when">${when}</span>
    ${abilities.length ? html`<ul class="reg-boss__abil">
      ${abilities.map((a, i) => html`<li key=${i}><${RichText} text=${a} /></li>`)}
    </ul>` : null}
    <span class="brief-stage"><${Icon} name="rook" /><b class="brief-stage__name">${stage?.name || pub.stageId || '—'}</b>${pool ? html`<span class="brief-stage__pool">${pool}</span>` : null}</span>
  </div>`;
}

/** 规程's right column: portrait, 敌方领袖 over the name, then one row per special enemy. No skill lines on the face. */
function regulationEnemies({ boss, bossEnemy, m, mode, pub, stage, pool, types, factions, idScope }) {
  const name = boss?.name || bossEnemy?.name || t('未知领袖');
  return html`<div class="brief-enemies brief-enemies--reg">
    <div class="brief-enemy">
      <${Tooltip} text=${leaderDetails({ mode, pub, boss, stage, pool })} tap=${true} block=${true} class="reg-boss__tt" tipClass="reg-boss__tip">
        <button type="button" class="brief-boss reg-boss">
          <div class="brief-boss__art">
            ${bossEnemy ? html`<${Img} src=${enemyIconUrl(m, boss.enemyKey)} class="brief-boss__img" fallback=${html`<span class="brief-boss__q">?</span>`} />`
              : html`<span class="brief-boss__q">?</span>`}
          </div>
          <div class="brief-boss__text">
            <span class="brief-boss__tag">${t('敌方领袖')}</span>
            <h2 class="brief-boss__name">${name}</h2>
          </div>
          <span class="sr-only">${leaderDetails({ mode, pub, boss, stage, pool })}</span>
        </button>
      <//>
      <div class="brief-factions reg-factions">
        ${types.length ? types.map((type) => factionCell({ type, info: factions[type], m, scope: idScope }))
          : html`<p class="t-dim">${t('本局没有特训敌人')}</p>`}
      </div>
    </div>
  </div>`;
}

/**
 * One 特训敌人 type: the round icon (focusable, named by the type, described by its text) and the name; the description
 * in the Tooltip (hover, keyboard focus, a long press on touch — anywhere on the cell; the box points at the icon, inside
 * the dialog when there is one, clear of the leader block) and in an .sr-only copy. A plain function (called, not a
 * component), so the markup sits in MatchEnemies' own tree.
 * @param {{ type: string, info: any, m: any, scope: string }} o
 */
function factionCell({ type, info, m, scope }) {
  const name = info?.name || type;
  const desc = info?.desc || '';
  const descId = desc ? factionDescId(scope, type) : undefined;
  return html`<${Tooltip} key=${type} text=${desc || null} block=${true} class="brief-faction__tt" tipClass="brief-faction__tip"
      anchor=".brief-faction__icon" within=".modal__box" avoid=${leaderBlockOf}>
    <div class="brief-faction" data-faction=${type}>
      <span class="brief-faction__icon" tabindex="0" role="img" aria-label=${name} aria-describedby=${descId}><${Img} src=${factionIconUrl(m, info?.icon)} /></span>
      <span class="brief-faction__text"><b>${slashBreaks(name)}</b></span>
      ${desc ? html`<span id=${descId} class="brief-faction__desc sr-only">${desc}</span>` : null}
    </div>
  <//>`;
}

/**
 * The briefing's 本局遭遇敌方 section body, also shown in the strategy draft's 本局信息 dialog.
 * @param {{ pub: any, gd: ReturnType<typeof import('./gameComponents.js').makeLookups>, idScope?: string, layout?: 'regulation'|null }} props
 *   `idScope`: the prefix of the descriptions' ids (the draft dialog passes its own).
 *   `layout`: `'regulation'` is the 规程 column (the label over the name; the round, abilities and battlefield stay in
 *   the tooltip and an .sr-only copy). Omitted, the markup below is the covenant block the draft dialog shares.
 */
export function MatchEnemies({ pub, gd, idScope = 'brief', layout = null }) {
  if (!pub) return null;
  const mode = gd.config?.modes?.[pub.modeId];
  const boss = pub.bossId ? gd.boss(pub.bossId) : null;
  const bossEnemy = boss ? gd.enemy(boss.enemyKey) : null;
  const stage = pub.stageId ? gd.stage(pub.stageId) : null;
  // the mode's battlefield pool (config.json modes[].stages): 标准 is always 战场#01, 险境+ draw one at random
  const poolN = Array.isArray(mode?.stages) ? mode.stages.length : 0;
  const pool = poolN > 1 ? t('战场随机（共{poolN}张）', { poolN }) : poolN === 1 ? t('战场固定') : '';
  const types = factionTypes(pub.factions);
  const factions = gd.factions?.types || {};
  const m = gd.m;

  if (layout === 'regulation') {
    return regulationEnemies({ boss, bossEnemy, m, mode, pub, stage, pool, types, factions, idScope });
  }

  return html`<div class="brief-enemies">
    <h3 class="brief-h"><span>${t('本局遭遇敌方')}</span><${MicroLabel}>ENEMY LEADER // SPECIAL ENEMIES</${MicroLabel}></h3>
    <div class="brief-enemy">
      <div class="brief-boss">
        <div class="brief-boss__art">
          ${bossEnemy ? html`<${Img} src=${enemyIconUrl(m, boss.enemyKey)} class="brief-boss__img" fallback=${html`<span class="brief-boss__q">?</span>`} />`
            : html`<span class="brief-boss__q">?</span>`}
        </div>
        <span class="brief-boss__tag">${t('敌方领袖')}</span>
      </div>
      <div class="brief-boss__text">
        <h2 class="brief-boss__name">${boss?.name || bossEnemy?.name || t('未知领袖')}</h2>
        <span class="brief-boss__when">${tParts('第 {r} 回合 · 最终攻势', { r: html`<b class="num">${mode?.bossRound ?? pub.lastRound ?? 14}</b>` })}</span>
        ${Array.isArray(boss?.abilities) && boss.abilities.length ? html`<ul class="brief-boss__abil">
          ${boss.abilities.slice(0, 3).map((a, i) => html`<li key=${i}><${RichText} text=${a} /></li>`)}
        </ul>` : null}
        <span class="brief-stage"><${Icon} name="rook" /><b class="brief-stage__name">${stage?.name || pub.stageId || '—'}</b>${pool ? html`<span class="brief-stage__pool">${pool}</span>` : null}</span>
      </div>
      <div class="brief-factions">
        ${types.length ? types.map((type) => factionCell({ type, info: factions[type], m, scope: idScope }))
          : html`<p class="t-dim">${t('本局没有特训敌人')}</p>`}
      </div>
    </div>
  </div>`;
}
