// Briefing — INFO_CHECK "1/2 确认本局信息" (research 06 §4.1, D1): enemy leader (silhouette, name,
// abilities), stage (+ its pool: 战场固定 / 战场随机（共N张）), 特训敌人 factions (icon, name, description), the difficulty
// tag, the ready count x/N with person pips, the 准备就绪 button (g.infoReady) and the countdown. The right column — 核心盟约
// / 附加盟约 rows of bond discs (disabled bonds greyed with the banned-member badge), the legend and the 本局禁用干员
// avatars, with the player's own 自选 pieces out of the shop (m.private.diyBanned) — is ui/matchInfo.js MatchInfo, the same
// blocks the strategy draft's 本局信息 dialog shows (screens/bandDraft.js).
// The event's layout (PR #643, video 6:29–7:51): one scrolling column of sections under grey header bars — 本局遭遇敌方
// (the leader's framed portrait over 敌方领袖, its text with the battlefield, the 特训敌人 as round icons on the right with
// the description in the tooltip), 核心盟约, 附加盟约 (the legend under it), 本局禁用干员 — with 已就绪 x/N over the person
// pips and the big 准备就绪 in the bottom-right corner. The sections come in from the right one after another
// (css/screens/briefing.css 开局转场).

import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, Tooltip } from '../ui/components.js';
import { useGameData, Img, RichText } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { MatchBondRow, MatchLegend, BannedOperators, matchInfoModel } from '../ui/matchInfo.js';
import { LoadoutButton } from './loadout.js';
import { UnofficialMark } from '../ui/pluginTag.js';
import { SetupReroll } from '../ui/setupReroll.js';
import { actions } from '../ui/gameActions.js';
import { factionTypes, sortedPlayers, phaseTotalSeconds } from '../ui/gameLogic.js';
import { enemyIconUrl, factionIconUrl } from '../ui/assetUrls.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { t, tParts } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** INFO_CHECK screen. */
export function BriefingScreen() {
  const pub = useStore((s) => s.match.public);
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const solo = useStore((s) => s.room?.mode === 'solo') || String(pub?.modeId || '').includes('single');
  // gameplay plugins (DESIGN §32.6): the briefing says the match is unofficial
  const room = useStore((s) => s.room);
  const gd = useGameData();
  const [exit, setExit] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!pub) return null;

  const players = sortedPlayers(pub);
  const me = players.find((p) => p.playerId === myId);
  const readyN = players.filter((p) => p.ready).length;
  const mode = gd.config?.modes?.[pub.modeId];
  // (+ the own 自选 pieces this match leaves out of the shop: m.private.diyBanned)
  const info = matchInfoModel(pub, { bonds: gd.list('bonds'), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } });
  const boss = pub.bossId ? gd.boss(pub.bossId) : null;
  const bossEnemy = boss ? gd.enemy(boss.enemyKey) : null;
  const stage = pub.stageId ? gd.stage(pub.stageId) : null;
  // the mode's battlefield pool (config.json modes[].stages): 标准 is always 战场#01, 险境+ draw one at random
  const poolN = Array.isArray(mode?.stages) ? mode.stages.length : 0;
  const pool = poolN > 1 ? t('战场随机（共{poolN}张）', { poolN }) : poolN === 1 ? t('战场固定') : '';
  const types = factionTypes(pub.factions);
  const factions = gd.factions?.types || {};
  const m = gd.m;

  const ready = async () => {
    if (busy || me?.ready) return;
    setBusy(true);
    await actions.infoReady(pub.setupRevision ?? 0);
    setBusy(false);
  };

  return html`<div class="screen brief">
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${1} of=${2} title=${t('确认本局信息')} micro="BRIEFING // INFO CHECK" pub=${pub}
      total=${phaseTotalSeconds(pub, gd.config)} onExit=${() => setExit(true)} />
    <${UnofficialMark} room=${room} class="brief__modmark" />
    <main class="brief__main">
      <section class="brief-sec brief-sec--enemy" style="--i:1">
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
            <span class="brief-stage"><${Icon} name="rook" /><b>${stage?.name || pub.stageId || '—'}</b>${pool ? html`<span class="brief-stage__pool">${pool}</span>` : null}</span>
          </div>
          <div class="brief-factions">
            ${types.length ? types.map((ty) => html`<${Tooltip} key=${ty} text=${factions[ty]?.desc || null}>
              <div class="brief-faction" tabindex="0">
                <span class="brief-faction__icon"><${Img} src=${factionIconUrl(m, factions[ty]?.icon)} /></span>
                <b class="brief-faction__name">${factions[ty]?.name || ty}</b>
              </div>
            <//>`) : html`<p class="t-dim">${t('本局没有特训敌人')}</p>`}
          </div>
        </div>
      </section>

      <section class="brief-sec brief-sec--core" style="--i:2"><${MatchBondRow} title=${t('核心盟约')} micro="CORE BONDS" bonds=${info.core} model=${info} /></section>
      <section class="brief-sec brief-sec--addon" style="--i:3">
        <${MatchBondRow} title=${t('附加盟约')} micro="ADD-ON BONDS" bonds=${info.addon} model=${info} />
        <${MatchLegend} model=${info} />
      </section>
      <section class="brief-sec brief-sec--banned" style="--i:4"><${BannedOperators} model=${info} /></section>
    </main>
    <${SetupReroll} pub=${pub} />
    <footer class="brief__foot">
      <${LoadoutButton} from="briefing" size="lg" class="brief-loadout" />
      <div class="brief-ready">
        <span class="brief-ready__txt">${t('已就绪')}:<b class="num">${readyN}</b><span class="num">/${players.length}</span></span>
        <span class="brief-ready__pips">${players.map((p) => html`<i key=${p.playerId} class=${cx(p.ready && 'on', p.playerId === myId && 'me')} title=${p.name}><${Icon} name="user" /></i>`)}</span>
      </div>
      <${Button} variant="primary" size="xl" class="brief-go" icon=${me?.ready ? 'check' : me ? 'play' : 'eye'} active=${!!me?.ready} loading=${busy}
        disabled=${!!me?.ready || !me || !!pub.rerollVote} onClick=${ready}>${me?.ready ? t('已就绪') : me ? t('准备就绪') : t('观战中')}<//>
    </footer>
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
  </div>`;
}
