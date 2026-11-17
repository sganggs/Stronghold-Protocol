import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { useStore } from '../store.js';
import { net } from '../net.js';
import { toastError } from './toasts.js';
import { DEFAULT_VERSION, roomVersion } from '../versions.js';
import { t } from '../../../shared/i18n.js';
export function AiTakeoverPanel() {
  const room = useStore(s => s.room), pub = useStore(s => s.match.public), myId = useStore(s => s.me.playerId);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  if (!room || room.aiTakeoverEnabled !== true || room.mode === 'solo' || roomVersion(room) !== DEFAULT_VERSION || room.content?.vanilla === false) return null;
  const run = async (kind, body) => { if (busy) return; setBusy(true); try { await net.request(kind, body); } catch (e) { toastError(e); } finally { setBusy(false); } };
  const spectator = room.spectators?.some(s => s.playerId === myId);
  const requests = room.aiTakeoverVotes || [], votes = requests;
  const bots = (pub?.players || []).filter(p => p.isBot && p.alive && !p.left);
  const name = id => (pub?.players || []).find(p => p.playerId === id)?.name || id;
  return html`<button type="button" class="btn ai-participation-entry" onClick=${() => setOpen(true)}>${t('AI 协作')}${votes.length ? ` (${votes.length})` : ''}</button>
    <${Modal} open=${open} onClose=${() => setOpen(false)} title=${t('AI 协作')} width="min(800px,92vw)" actions=${html`<${Button} onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <p>${t('观战者申请接替AI，同房间在线且未托管的真人过半同意后在休整期加入；无合格队友时由在线房主决定。')}</p>
      <p>${t('申请在退出、断线、投票资格或阶段变化时取消。接替后的席位数据含 AI 此前表现，不计入你的个人统计或奖励。')}</p>
      ${spectator ? html`<div class="ai-requests">${bots.map(p => html`<${Button} disabled=${busy || pub.phase !== 'PREP' || requests.some(v => v.botId === p.playerId || v.applicantId === myId)} onClick=${() => run('room.aiRequest', { botId: p.playerId })}>${t('申请接替')} P${p.seat + 1} · ${p.name}<//>`)}</div>` : null}
      ${requests.map(v => html`<div class="ai-vote"><strong>${v.applicantName} → ${name(v.botId)}</strong><span>${v.yes.filter(id => v.eligible.includes(id)).length}/${Math.floor(v.eligible.length / 2) + 1}</span>
        ${v.eligible.includes(myId) ? html`<${Button} disabled=${busy || pub?.phase !== 'PREP'} onClick=${() => run('room.aiVote', { voteId: v.id, approve: true })}>${t('同意')}<//><${Button} disabled=${busy} onClick=${() => run('room.aiVote', { voteId: v.id, approve: false })}>${t('不同意')}<//>` : null}</div>`)}
      ${!votes.length ? html`<p>${t('暂无投票')}</p>` : null}
    <//>`;
}
