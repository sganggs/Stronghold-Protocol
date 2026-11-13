// 规程 INFO_CHECK (config.version.family === 'regulation'): the two-column briefing. Every other family keeps
// screens/briefing.js's one column, so that file's markup stays the one the draft dialog and its tests share.
// Left, one scroll: 核心盟约, 附加盟约 (the legend chip is the header), 本局禁用干员 grouped by bond.
// Right, fixed: the stage preview, 敌方领袖 (name only), one row per special enemy, 干员调配, 已就绪, 准备就绪.
// 重刷本局 stays a full-width bar under the columns. The version tag stays under the step header.

import { html, Button, Icon } from './components.js';
import { StepHeader, ExitModal } from './matchChrome.js';
import { MatchBondGroups, MatchBondRow, BannedByBond, MatchBondDialog, regulationCoreAbsent, RegulationHead } from './matchInfo.js';
import { MatchEnemies } from './matchEnemies.js';
import { LoadoutButton } from '../screens/loadout.js';
import { UnofficialMark, VersionTag } from './pluginTag.js';
import { SetupReroll } from './setupReroll.js';
import { StagePreview, stagePreviewChoice } from './stagePreview.js';
import { phaseTotalSeconds, pregameStepCount, pregameStepIndex } from './gameLogic.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** True only when this page's data is the 规程 family. A bond id is not a season. */
export function regulationBriefingLayout(config) {
  return config?.version?.family === 'regulation';
}

/**
 * The 规程 briefing. Hookless: the map dialog's state lives in StagePreview.
 * @param {{ pub: any, gd: any, room: any, solo: boolean, info: any, players: any[], me: any, readyN: number,
 *   myId: string|null, exit: boolean, setExit: Function, busy: boolean, bondId: string|null, setBondId: Function,
 *   ready: Function, pickGroup: Function, priv: any }} props
 */
export function RegulationBriefing({ pub, gd, room, solo, info, players, me, readyN, myId, exit, setExit, busy, bondId, setBondId, ready, pickGroup, priv }) {
  const stage = pub?.stageId && gd.stage ? gd.stage(pub.stageId) : null;
  const localGroups = data.get('local')?.groups || null;
  const choice = stagePreviewChoice({ ui: gd.m?.ui, localGroups }, pub?.stageId);
  const mode = gd.config?.modes?.[pub.modeId];
  const poolN = Array.isArray(mode?.stages) ? mode.stages.length : 0;
  const pool = poolN > 1 ? t('战场随机（共{poolN}张）', { poolN }) : poolN === 1 ? t('战场固定') : '';
  const stageName = stage?.name || pub.stageId || '—';
  const hold = !me || !!me.ready || !!pub.rerollVote;

  return html`<div class="screen brief brief--reg" data-layout="regulation">
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${pregameStepIndex(gd.config, 'INFO_CHECK')} of=${pregameStepCount(gd.config)} title=${t('确认本局信息')} micro="BRIEFING // INFO CHECK" pub=${pub}
      total=${phaseTotalSeconds(pub, gd.config)} onExit=${() => setExit(true)} />
    <${UnofficialMark} room=${room} class="brief__modmark" /><${VersionTag} room=${room} class="brief__vertag" />
    <div class="brief__split">
      <div class="brief__scroll">
        <section class="brief-sec brief-sec--core" style="--i:1">
          <${MatchBondGroups} panels=${true} model=${info} onPick=${pickGroup} onBond=${setBondId} disabled=${hold} busy=${busy} />
        </section>
        <section class="brief-sec brief-sec--addon" style="--i:2">
          <${MatchBondRow} title=${t('附加盟约')} micro="ADD-ON BONDS" bonds=${info.addon} model=${info} onBond=${setBondId}
            head=${html`<${RegulationHead} title=${t('附加盟约')} />`} />
        </section>
        <section class="brief-sec brief-sec--banned" style="--i:3">
          <${BannedByBond} model=${info} onBond=${setBondId} />
        </section>
      </div>
      <aside class="brief__side">
        <${StagePreview} stage=${stage} choice=${choice} name=${stageName} pool=${pool} stageId=${pub?.stageId || ''}
          localGroups=${localGroups} seat=${me?.seat ?? null} />
        <${MatchEnemies} pub=${pub} gd=${gd} layout="regulation" />
        <${LoadoutButton} from="briefing" size="md" class="reg-loadout" />
        <div class="reg-ready">
          <div class="brief-ready">
            <span class="brief-ready__txt">${t('已就绪')}<b class="num">${readyN}</b><span class="num">/${players.length}</span></span>
            <span class="brief-ready__pips">${players.map((p) => html`<i key=${p.playerId} class=${cx(p.ready && 'on', p.playerId === myId && 'me')} title=${p.name}><${Icon} name="user" /></i>`)}</span>
          </div>
          <${Button} variant="primary" size="xl" class="brief-go" icon=${me?.ready ? 'check' : me ? 'play' : 'eye'} active=${!!me?.ready} loading=${busy}
            disabled=${!!me?.ready || !me || !!pub.rerollVote || info.choice?.picked === null} onClick=${ready}>${me?.ready ? t('已就绪') : me ? t('准备就绪') : t('观战中')}<//>
        </div>
      </aside>
    </div>
    <${SetupReroll} pub=${pub} />
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
    <${MatchBondDialog} bondId=${bondId} onClose=${() => setBondId(null)} priv=${priv} banned=${info.banned} off=${info.sets.off.has(bondId)} coreAbsent=${regulationCoreAbsent(info, bondId)} />
  </div>`;
}
