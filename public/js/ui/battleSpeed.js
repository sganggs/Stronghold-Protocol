import { useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { t, N_ } from '../../../shared/i18n.js';

const label = n => n === 1 ? t('正常速度') : n === 2 ? t('两倍速度') : t('四倍速度');
const outcomes = {
  passed: N_('倍速投票已通过'), expired: N_('倍速投票已超时'), members: N_('参与人员变化，投票已取消'),
  reject: N_('倍速投票被拒绝'), withdraw: N_('同意已撤回，投票已取消'), cancel: N_('倍速投票已取消'),
  ended: N_('战斗结束，投票已取消'), locked: N_('快速结算中，投票已取消'),
};

export function BattleSpeed({ state, myId, onVote }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!state) return null;
  const v = state.vote;
  const can = state.available && state.eligible.includes(myId) && !!onVote;
  const send = async (action, target) => {
    setBusy(true); setError(false);
    try { await onVote({ phaseId: state.phaseId, revision: state.revision, action,
      ...(target ? { target } : {}), ...(v ? { voteId: v.id } : {}) }); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return html`<div class="battle-speed" aria-live="polite">
    <span>${t('战斗倍速')}：${label(state.multiplier)}${v ? html` → ${label(v.target)}` : null}</span>
    ${v ? html`<span>${t('已同意 {n}/{total}', { n: v.agreed.length, total: v.eligible.length })}</span>
      <small>${t('15 秒内全票同意才会切换')}</small>
      ${can ? html`
        <button disabled=${busy} onClick=${() => send(v.agreed.includes(myId) ? 'withdraw' : 'agree')}>${v.agreed.includes(myId) ? t('撤回同意') : t('同意切换')}</button>
        <button disabled=${busy} onClick=${() => send(v.proposer === myId ? 'cancel' : 'reject')}>${v.proposer === myId ? t('取消投票') : t('拒绝切换')}</button>` : null}`
      : can ? [1, 2, 4].map(n => html`<button disabled=${busy || state.multiplier === n} onClick=${() => send('propose', n)}>${label(n)}</button>`) : null}
    ${state.outcome ? html`<small>${t(outcomes[state.outcome] || N_('倍速投票已取消'))}</small>` : null}
    ${error ? html`<small>${t('请求失败，请重试')}</small>` : null}
  </div>`;
}
