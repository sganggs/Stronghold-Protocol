// A server-owned unanimous vote. Reconnects render the current vote from m.public.
// A non-host only 申请重刷 (room.requestReroll, GitHub #854): the host starts the vote, so the request just reaches
// them — m.public.rerollRequests lists it for the whole room and the asker's button stays 已申请重刷 until the host
// proposes, refuses or the opening changes.
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
  const requests = vote ? [] : (pub.rerollRequests || []);
  const asked = requests.some((r) => r.playerId === myId);
  const askerName = (id) => players.find((p) => p.playerId === id)?.name || id;
  const askers = requests.map((r) => askerName(r.playerId));
  const send = async (fn) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await fn(); } finally { pending.current = false; setBusy(false); }
  };
  // Without a seat (a spectator) there is nothing to ask for; a running vote stays read-only for them, as before.
  if (!vote && !me) return null;
  const hint = vote ? t('全员同意后重新随机战场、领袖、特训敌人和禁用；确认倒计时已暂停。')
    : host ? t('保留房间和个人配置，重新随机全部开局信息。')
      : asked ? t('已通知房主，等待房主发起重刷投票；全体真人玩家一致同意后才会重新随机。')
        : t('申请后由房主发起投票，全体真人玩家一致同意才会重新随机开局信息。');
  return html`<section class="brief-reroll" aria-label=${t('重刷本局')} aria-live="polite">
    <div class="brief-reroll__text">
      <strong>${vote ? t('重刷本局投票：{agreed}/{total}', { agreed: vote.agreed.length, total: vote.voters.length })
        : host ? t('重刷本局') : asked ? t('已申请重刷') : t('申请重刷本局')}</strong>
      <span>${hint}</span>
      ${vote ? html`<div class="brief-reroll__players">${vote.voters.map((id) => {
        const p = players.find((p) => p.playerId === id);
        return html`<span key=${id} class=${vote.agreed.includes(id) ? 'is-agreed' : ''}>${p?.name || id} · ${vote.agreed.includes(id) ? t('已同意') : t('待同意')}</span>`;
      })}</div>` : null}
      ${!vote && host && askers.length ? html`<div class="brief-reroll__players">${requests.map((r) =>
        html`<span key=${r.playerId} class="is-agreed">${t('{who} 申请重刷本局', { who: askerName(r.playerId) })}</span>`)}</div>` : null}
    </div>
    <div class="brief-reroll__actions">
      ${!vote ? html`<${Button} icon="refresh" size="lg" loading=${busy} disabled=${!online || (host ? !allConnected : asked)}
        title=${host ? (allConnected ? t('全体真人玩家一致同意后刷新，随机结果可能重复。') : t('请等待所有玩家连接后再发起投票'))
          : asked ? t('已通知房主，等待房主发起重刷投票；全体真人玩家一致同意后才会重新随机。') : t('申请后由房主发起投票，全体真人玩家一致同意才会重新随机开局信息。')}
        onClick=${() => send(() => (host ? actions.rerollSetup(pub.setupRevision ?? 0) : actions.requestReroll(pub.setupRevision ?? 0)))}
        >${host ? t('重刷本局') : asked ? t('已申请重刷') : t('申请重刷')}<//>` : null}
      ${vote && voter ? html`<${Button} variant="primary" loading=${busy} disabled=${!online || agreed}
        onClick=${() => send(() => actions.rerollVote(vote.id, true))}>${agreed ? t('已同意') : t('同意重刷')}<//>
        <${Button} variant="danger" disabled=${busy || !online}
          onClick=${() => send(() => actions.rerollVote(vote.id, false))}>${t('拒绝重刷')}<//>` : null}
      ${vote && host && me ? html`<${Button} disabled=${busy || !online}
        onClick=${() => send(() => actions.cancelReroll(vote.id))}>${t('取消投票')}<//>` : null}
    </div>
  </section>`;
}
