// In-match popups (2026-10-13, the owner's request: the event's in-match motion, video 7:57–8:00 and 8:32–8:52),
// original drawings only (ui/pixbots.js). One dark translucent plate in the middle of the field:
//   * RoundPopup — at each round start: [robot] · 回合 NN (the old number drops away, the new one falls in) · 获得 ⁂ (the
//     coins flash, +N slides in with sparks); a red strip 「剩余 N 回合」 on top while the final assault is three rounds or
//     fewer away. It folds away by itself (≈2.5 s).
//   * PhasePopup — a phase that starts with words: 联防阶段 (orange, two robots, big chevrons sweeping right), 机变阶段,
//     最终攻势 / 隐秘核心. Words from ui/gameLogic/phases.js phaseBanner.
// screens/game.js picks the moment; pointer-events none, so the field stays usable under them. Styles: css/screens/game.css
// 局内弹窗. With prefers-reduced-motion they still show (the information), without the motion.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { CoinGlyph } from './gameComponents.js';
import { PixBot } from './pixbots.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** How long the round popup holds before it folds away (ms), and the fold. */
export const ROUND_POPUP_MS = 2300;
const LEAVE_MS = 280;

/** Two-digit round number as the plate shows it (00 before the first round). */
export const roundDigits = (n) => String(Math.max(0, Math.trunc(Number(n) || 0)) % 100).padStart(2, '0');

/**
 * Rounds left before the final assault, for the red strip: 1–3, else null (no strip). `pub.bossRound` is the final
 * assault's round; the hidden core and random mode's last round get no strip.
 * @param {any} pub m.public
 */
export function roundsToBoss(pub) {
  const r = Math.trunc(Number(pub?.round));
  const b = Math.trunc(Number(pub?.bossRound));
  if (!Number.isFinite(r) || !Number.isFinite(b) || r <= 0 || pub?.randomMode) return null;
  const left = b - r;
  return left >= 1 && left <= 3 ? left : null;
}

/** Auto-dismiss: `leaving` after `ms`, onDone after the fold. Re-key the popup to replay it. */
export function useTimedLeave(ms, onDone) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setLeaving(true), ms);
    const b = setTimeout(() => onDone?.(), ms + LEAVE_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  return leaving;
}

/** The plate's left block: corner crosses, side brackets, the drawing(s) and a line of fine type under them. */
function PopArt({ kinds, tag }) {
  return html`<div class="mpop__art" aria-hidden="true">
    <i class="mpop__x mpop__x--tl"></i><i class="mpop__x mpop__x--tr"></i><i class="mpop__x mpop__x--bl"></i><i class="mpop__x mpop__x--br"></i>
    <i class="mpop__brk mpop__brk--l"></i><i class="mpop__brk mpop__brk--r"></i>
    <span class="mpop__bots">${kinds.map((k, i) => html`<${PixBot} key=${i} kind=${k} class=${`mpop__bot mpop__bot--${i}`} />`)}</span>
    <span class="mpop__tag">${tag}</span>
  </div>`;
}

/**
 * The round-start plate.
 * @param {{ round: number, gain?: number|null, left?: number|null, onDone?: Function }} props
 *   gain: the funds this round start paid (null = not known / not in the round: the coins without a number)
 *   left: rounds before the final assault (roundsToBoss) — the red strip on top
 */
export function RoundPopup({ round, gain = null, left = null, onDone }) {
  const leaving = useTimedLeave(ROUND_POPUP_MS, onDone);
  const n = Number.isFinite(gain) && gain > 0 ? Math.trunc(gain) : null;
  return html`<div class=${cx('mpop', 'mpop--round', leaving && 'is-leaving')} role="status" aria-live="polite"
      aria-label=${t('第 {r} 回合', { r: round })} data-testid="round-popup">
    <div class="mpop__panel">
      ${left ? html`<div class="mpop__head"><span class="mpop__warn" aria-hidden="true"></span>${t('剩余')} <b class="num">${left}</b> ${t('回合')}</div>` : null}
      <${PopArt} kinds=${['bot']} tag="ROUND // START" />
      <div class="mpop__cell mpop__cell--round">
        <span class="mpop__k">${t('回合')}</span>
        <span class="mpop__roll num"><b class="mpop__old">${roundDigits(round - 1)}</b><b class="mpop__new">${roundDigits(round)}</b></span>
      </div>
      <div class="mpop__cell mpop__cell--gold">
        <span class="mpop__k">${t('获得')}</span>
        <span class="mpop__gain"><i class="mpop__flare" aria-hidden="true"></i><${CoinGlyph} class="mpop__coin" />${n ? html`<b class="mpop__plus num">+${n}</b>` : null}</span>
        ${n ? [0, 1, 2, 3, 4, 5, 6].map((i) => html`<i key=${i} class="mpop__spark" style=${`--i:${i}`} aria-hidden="true"></i>`) : null}
      </div>
    </div>
  </div>`;
}

/**
 * A phase plate: drawings, title (+ optional line), chevrons sweeping through on the right (联防 / boss rounds).
 * @param {{ tone?: 'mint'|'orange'|'red'|'gold', kinds?: string[], title: any, sub?: any, micro?: string, chev?: boolean,
 *   duration?: number, onDone?: Function }} props
 */
export function PhasePopup({ tone = 'mint', kinds = ['bot'], title, sub = null, micro = '', chev = false, duration = 2200, onDone }) {
  const leaving = useTimedLeave(duration, onDone);
  return html`<div class=${cx('mpop', 'mpop--phase', `mpop--${tone}`, chev && 'has-chev', leaving && 'is-leaving')} role="status" aria-live="polite"
      data-testid="phase-popup">
    <div class="mpop__panel">
      <${PopArt} kinds=${kinds} tag=${micro} />
      <div class="mpop__text">
        <span class="mpop__title">${title}</span>
        ${sub ? html`<span class="mpop__sub">${sub}</span>` : null}
      </div>
      ${chev ? html`<span class="mpop__chevs" aria-hidden="true"><i></i><i></i><i></i></span>` : null}
      <span class="mpop__deco" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    </div>
  </div>`;
}

/**
 * The popup a phase starts with (screens/game.js), from its phaseBanner words — or null: 回合开始 has RoundPopup,
 * 最终攻势 the merged-LP plate (ui/matchPlates.js FinalAssaultPlate), and 休整期 / 作战开始 have none (the top bar's
 * capsule says it, ui/hud.js CapsuleFx).
 * @param {string} phase @param {{ title: any, sub?: any, micro?: string, tone?: string } | null} banner
 */
export function phasePopupOf(phase, banner) {
  if (!banner) return null;
  switch (phase) {
    case 'UNITE': return { tone: 'orange', kinds: ['happy', 'worried'], chev: true, duration: 2600, ...pick(banner) };
    case 'SP_DRAFT': return { tone: 'gold', kinds: ['bot'], chev: false, duration: 1800, ...pick(banner) };
    case 'HIDDEN_CORE': return { tone: 'red', kinds: ['worried'], chev: true, duration: 2600, ...pick(banner) };
    default: return null;
  }
}
const pick = (b) => ({ title: b.title, sub: b.sub || null, micro: b.micro || '' });
