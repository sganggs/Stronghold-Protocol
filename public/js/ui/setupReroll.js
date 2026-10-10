// A server-owned unanimous vote. Reconnects render the current vote from m.public.
import { useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { actions } from './gameActions.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function SetupReroll({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  const hostId = useStore((s) => s.room?.hostId);
  const online = useStore((s) => s.connection.status === 'online');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const vote = pub.rerollVote;
  const host = myId === hostId;
  const players = pub.players || [];
  const me = players.find((p) => p.playerId === myId && p.status !== 'left');
  const allConnected = players.every((p) => p.isBot || p.status === 'left' || p.connected);
  const voter = !!vote?.voters.includes(myId);
  const agreed = !!vote?.agreed.includes(myId);
  const send = async (fn) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await fn(); } finally { pending.current = false; setBusy(false); }
  };
  if (!vote && (!host || !me)) return null;
  return html`<section class="brief-reroll" aria-label=${t('重刷本局')} aria-live="polite">
    <div class="brief-reroll__text">
      <strong>${vote ? t('重刷本局投票：{agreed}/{total}', { agreed: vote.agreed.length, total: vote.voters.length }) : t('重刷本局')}</strong>
      <span>${vote ? t('全员同意后重新随机战场、领袖、特训敌人和禁用；确认倒计时已暂停。') : t('保留房间和个人配置，重新随机全部开局信息。')}</span>
      ${vote ? html`<div class="brief-reroll__players">${vote.voters.map((id) => {
        const p = players.find((p) => p.playerId === id);
        return html`<span key=${id} class=${vote.agreed.includes(id) ? 'is-agreed' : ''}>${p?.name || id} · ${vote.agreed.includes(id) ? t('已同意') : t('待同意')}</span>`;
      })}</div>` : null}
    </div>
    <div class="brief-reroll__actions">
      ${!vote ? html`<${Button} icon="refresh" size="lg" loading=${busy} disabled=${!online || !allConnected}
        title=${allConnected ? t('全体真人玩家一致同意后刷新，随机结果可能重复。') : t('请等待所有玩家连接后再发起投票')}
        onClick=${() => send(() => actions.rerollSetup(pub.setupRevision ?? 0))}>${t('重刷本局')}<//>` : null}
      ${vote && voter ? html`<${Button} variant="primary" loading=${busy} disabled=${!online || agreed}
        onClick=${() => send(() => actions.rerollVote(vote.id, true))}>${agreed ? t('已同意') : t('同意重刷')}<//>
        <${Button} variant="danger" disabled=${busy || !online}
          onClick=${() => send(() => actions.rerollVote(vote.id, false))}>${t('拒绝重刷')}<//>` : null}
      ${vote && host && me ? html`<${Button} disabled=${busy || !online}
        onClick=${() => send(() => actions.cancelReroll(vote.id))}>${t('取消投票')}<//>` : null}
    </div>
  </section>`;
}
