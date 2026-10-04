// Chrome shared by every in-match screen: the step header of the pre-game screens (exit + ping +
// difficulty | "1/2 确认本局信息" | countdown) and the exit flow (confirm with 暂离 / 放弃, AI 托管 overlay).
//
// 暂离 (co-op): turns on AI 托管 (g.autoplay on) so the seat keeps playing; the overlay's 返回模拟 turns it
// off. 放弃模拟: g.leave then room.leave (the platform treats it as a quit), back to the lobby.

import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, PingPill, DifficultyTag, Countdown, MicroLabel } from './components.js';
import { actions } from './gameActions.js';
import { toastError } from './toasts.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, createStore } from '../store.js';
import { GIcon } from './gameComponents.js';
import { GuideButton } from './guide.js';
import { T } from '../i18n.js';
/**
 * Exit dialog lines. 放弃模拟 (g.leave → room.leave) ends the run on the server as 'abandoned' and returns to the
 * lobby straight away — no settlement screen follows, so the solo text must not promise one.
 */
export const EXIT_TEXT = Object.freeze({
  soloRest: T('独立模拟的休整期没有时间限制，你可以随时继续。'),
  soloQuit: T('放弃模拟将立即结束本局并返回大厅，本局进度不会保留，也不会进行结算。'),
});

/** Local "暂离 / AI 托管" flag (the server keeps no per-client autoplay view). */
export const awayStore = createStore({ away: false });

/**
 * Whether a store change ends the match the 暂离 flag belongs to: its state was cleared (result → 返回同盟, 放弃模拟, a
 * new match starting, the room closing, a new server session) or its settlement arrived. The next match must never
 * open under the previous one's "AI 托管中" overlay (the server starts every match with autoplay off).
 * @param {any} s store state
 * @param {any} prev previous store state
 */
export const awayEnds = (s, prev) => (!!prev?.match?.public && !s?.match?.public) || (!!s?.match?.result && !prev?.match?.result);
store.subscribe((s, prev) => { if (awayStore.get().away && awayEnds(s, prev)) awayStore.set({ away: false }); });

/**
 * Leave the match for good (g.leave → room.leave), then drop local room/match state.
 * @returns {Promise<void>}
 */
export async function quitMatch() {
  try {
    try { await net.request('g.leave', {}); } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM' && err?.code !== 'WRONG_PHASE' && err?.code !== 'OFFLINE') throw err;
    }
    try { await net.request('room.leave', {}); } catch (err) { if (err?.code !== 'NOT_IN_ROOM' && err?.code !== 'OFFLINE') throw err; }
  } catch (err) {
    toastError(err);
  } finally {
    store.set({ room: null, match: emptyMatch() });
  }
}

/**
 * Exit confirmation modal.
 * @param {{ open: boolean, onClose: Function, solo: boolean, onAway?: Function }} props
 */
export function ExitModal({ open, onClose, solo, onAway }) {
  const [busy, setBusy] = useState(null);
  const quit = async () => {
    setBusy('quit');
    await quitMatch();
    setBusy(null);
    onClose();
  };
  const away = async () => {
    setBusy('away');
    const ok = await actions.autoplay(true);
    setBusy(null);
    onClose();
    if (ok) { awayStore.set({ away: true }); onAway?.(); }
  };
  return html`<${Modal} open=${open} onClose=${onClose} tone="red" title=${T('离开模拟')} micro="LEAVE SIMULATION" width="6.8rem"
    actions=${html`
      <${Button} variant="secondary" onClick=${onClose}>${T('取消')}<//>
      ${!solo ? html`<${Button} variant="ice" icon="robot" loading=${busy === 'away'} onClick=${away}>${T('暂离（AI 托管）')}<//>` : null}
      <${Button} variant="danger" icon="exit" loading=${busy === 'quit'} onClick=${quit}>${T('放弃模拟')}<//>`}>
    <div class="exitm">
      ${solo
        ? html`<p>${EXIT_TEXT.soloRest}</p><p class="t-lo">${EXIT_TEXT.soloQuit}</p>`
        : html`<p><b class="t-ice">${T('暂离')}</b>${T('：由 AI 托管你的席位（自动部署、准备与选择），随时可以返回。')}</p>
               <p><b class="t-red">${T('放弃模拟')}</b>${T('：离开后无法返回本局，你的干员将回到共享卡池。')}</p>`}
    </div>
  <//>`;
}

/** Full-screen "AI 托管中" overlay with 返回模拟. */
export function AwayOverlay({ onBack = () => {} }) {
  const [busy, setBusy] = useState(false);
  return html`<div class="awayov" role="dialog" aria-label=${T('AI 托管中')}>
    <div class="awayov__box brackets">
      <${GIcon} name="robot" class="awayov__icon" />
      <${MicroLabel} tone="mint">${T('AUTOPILOT // AI 托管')}</${MicroLabel}>
      <h2>${T('AI 托管中')}</h2>
      <p class="t-lo">${T('AI 正在代为操作你的席位')}</p>
      <${Button} variant="primary" size="lg" icon="play" loading=${busy} onClick=${async () => { setBusy(true); const ok = await actions.autoplay(false); setBusy(false); if (ok) { awayStore.set({ away: false }); onBack(); } }}>${T('返回模拟')}<//>
    </div>
  </div>`;
}

/**
 * Pre-game step header.
 * @param {{ step: number, of: number, title: string, micro: string, pub: any, total?: number|null, onExit: Function }} props
 */
export function StepHeader({ step, of, title, micro, pub, total, onExit }) {
  const conn = useStore((s) => s.connection, shallowEqual);
  return html`<header class="stephead">
    <div class="stephead__left">
      <${Button} variant="danger" size="lg" square=${true} icon="exit" onClick=${onExit} aria-label=${T('离开')} title=${T('离开')} />
      <div class="stephead__meta">
        <${PingPill} ms=${conn.ping} online=${conn.status === 'online'} />
        ${pub?.difficulty ? html`<${DifficultyTag} difficulty=${pub.difficulty} />` : null}
      </div>
    </div>
    <div class="stephead__center">
      <${MicroLabel} tone="mint">${micro}</${MicroLabel}>
      <h1 class="stephead__title"><b class="num">${step}</b><span class="num stephead__of">/${of}</span>${title}</h1>
    </div>
    <div class="stephead__right">
      <${GuideButton} class="stephead__guide" variant="secondary" />
      <${Countdown} deadline=${pub?.deadline} total=${total ?? undefined} size="md" />
    </div>
  </header>`;
}

