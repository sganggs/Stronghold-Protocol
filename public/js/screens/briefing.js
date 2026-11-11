// Briefing — INFO_CHECK "1/2 确认本局信息" (research 06 §4.1, D1): enemy leader (silhouette, name,
// abilities), stage (+ its pool: 战场固定 / 战场随机（共N张）), 特训敌人 factions (icon, name, description), the difficulty
// tag, the ready count x/N with person pips, the 准备就绪 button (g.infoReady) and the countdown. The 核心盟约 / 附加盟约
// rows of bond discs (disabled bonds greyed with the banned-member badge), the legend and the 本局禁用干员 avatars, with
// the player's own 自选 pieces out of the shop (m.private.diyBanned), are ui/matchInfo.js MatchBondRow / MatchLegend /
// BannedOperators, the blocks the strategy draft's 本局信息 dialog shows (screens/bandDraft.js). The enemy section is shared too:
// ui/matchEnemies.js MatchEnemies (GitHub #484, DESIGN §35.6).
// The event's layout (PR #643, video 6:29–7:51): one scrolling column of sections under grey header bars — 本局遭遇敌方
// (MatchEnemies: the leader's framed portrait over 敌方领袖, its text with the battlefield, the 特训敌人 as round icons
// with their names, the description in a tooltip — the maintainer's decision of 2026-10-22), 核心盟约, 附加盟约 (the legend
// under it), 本局禁用干员 — with 已就绪 x/N over the person pips (已就绪 2/4 as research 06 §4.1 reads it, no colon) and
// the big 准备就绪 in the bottom-right corner. The sections come in from the right one after another
// (css/screens/briefing.css 开局转场).

import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon } from '../ui/components.js';
import { useGameData } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { MatchBondGroups, MatchBondRow, MatchLegend, BannedOperators, matchInfoModel, MatchBondDialog, regulationCoreAbsent } from '../ui/matchInfo.js';
import { MatchEnemies } from '../ui/matchEnemies.js';
import { LoadoutButton } from './loadout.js';
import { UnofficialMark, VersionTag } from '../ui/pluginTag.js';
import { SetupReroll } from '../ui/setupReroll.js';
import { actions } from '../ui/gameActions.js';
import { sortedPlayers, phaseTotalSeconds, pregameStepCount, pregameStepIndex } from '../ui/gameLogic.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

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
  const [bondId, setBondId] = useState(null);
  if (!pub) return null;

  const players = sortedPlayers(pub);
  const me = players.find((p) => p.playerId === myId);
  const readyN = players.filter((p) => p.ready).length;
  const mode = gd.config?.modes?.[pub.modeId];
  // (+ the own 自选 pieces this match leaves out of the shop: m.private.diyBanned)
  const info = matchInfoModel(pub, { bonds: gd.list('bonds'), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } });

  const ready = async () => {
    if (busy || me?.ready) return;
    setBusy(true);
    await actions.infoReady(pub.setupRevision ?? 0);
    setBusy(false);
  };

  const pickGroup = async (idx) => {
    if (busy || !me || pub.rerollVote) return;
    setBusy(true);
    try { await actions.bondGroup(idx, pub.setupRevision ?? 0); }
    finally { setBusy(false); }
  };

  return html`<div class="screen brief">
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${pregameStepIndex(gd.config, 'INFO_CHECK')} of=${pregameStepCount(gd.config)} title=${t('确认本局信息')} micro="BRIEFING // INFO CHECK" pub=${pub}
      total=${phaseTotalSeconds(pub, gd.config)} onExit=${() => setExit(true)} />
    <${UnofficialMark} room=${room} class="brief__modmark" /><${VersionTag} room=${room} class="brief__vertag" />
    <main class="brief__main">
      <section class="brief-sec brief-sec--enemy" style="--i:1">
        <${MatchEnemies} pub=${pub} gd=${gd} />
      </section>

      <section class="brief-sec brief-sec--core" style="--i:2"><${MatchBondGroups} model=${info} onPick=${pickGroup} onBond=${setBondId} disabled=${!me || !!me.ready || !!pub.rerollVote} busy=${busy} /></section>
      <section class="brief-sec brief-sec--addon" style="--i:3">
        <${MatchBondRow} title=${t('附加盟约')} micro="ADD-ON BONDS" bonds=${info.addon} model=${info} onBond=${setBondId} />
        <${MatchLegend} model=${info} />
      </section>
      <section class="brief-sec brief-sec--banned" style="--i:4"><${BannedOperators} model=${info} /></section>
    </main>
    <${SetupReroll} pub=${pub} />
    <footer class="brief__foot">
      <${LoadoutButton} from="briefing" size="lg" class="brief-loadout" />
      <div class="brief-ready">
        <span class="brief-ready__txt">${t('已就绪')}<b class="num">${readyN}</b><span class="num">/${players.length}</span></span>
        <span class="brief-ready__pips">${players.map((p) => html`<i key=${p.playerId} class=${cx(p.ready && 'on', p.playerId === myId && 'me')} title=${p.name}><${Icon} name="user" /></i>`)}</span>
      </div>
      <${Button} variant="primary" size="xl" class="brief-go" icon=${me?.ready ? 'check' : me ? 'play' : 'eye'} active=${!!me?.ready} loading=${busy}
        disabled=${!!me?.ready || !me || !!pub.rerollVote || info.choice?.picked === null} onClick=${ready}>${me?.ready ? t('已就绪') : me ? t('准备就绪') : t('观战中')}<//>
    </footer>
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
    <${MatchBondDialog} bondId=${bondId} onClose=${() => setBondId(null)} priv=${priv} banned=${info.banned} off=${info.sets.off.has(bondId)} coreAbsent=${regulationCoreAbsent(info, bondId)} />
  </div>`;
}
