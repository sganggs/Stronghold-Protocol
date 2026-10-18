// In-match popups (PR #643's round / phase plates, redone with the official art): one dark translucent plate in the
// middle of the field, built from the official `roundStartDialog/*` sprites (data/assets.json ui) — the boxed robot
// (round_bg, round_cross, round_frame, round_emoji_head / body / hand / book, round_text_01), the funds icon
// (round_sources_icon) and the red 剩余 N 回合 strip (round_countdown_bg):
//   * RoundPopup — at each round start (the event's footage, video 7:57–8:01): [robot] · 回合 NN (the old number drops away,
//     the new one falls in) · 获得 ⁂ +N, the funds the round start paid; it folds away by itself after ≈ 2 s. An eliminated
//     player and a spectator seat get no 获得 cell (no income reaches them, GitHub #236 / #237): phaseBanner's line for them
//     (gameLogic/phases.js, 观战中) stands under the plate instead. The red 剩余 N 回合 strip shows while the final assault
//     is three rounds or fewer away (the footage: 剩余 3 回合 at round 11 of a round-14 final assault, video 8:53).
//   * PhasePopup — 联防阶段 (the footage, video 8:39): the same plate in orange with the two official 联防 faces
//     (hudPanel/trans_coop4 / trans_coop3, scaled up as pixel art), the words and chevrons sweeping right. The footage has
//     no plate for the other phases: they keep the banner.
// The arrangement — the robot assembled in its box (book left, head upper right, the hand pointing right, pixel dots
// around the head), the cells beside it — follows the footage; positions are measured from it. Every sprite has a CSS
// fallback.
// screens/game.js picks the moment; pointer-events none, so the field stays usable under them. Styles:
// css/screens/match-popups.css. With prefers-reduced-motion they still show (the information), without the motion.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { CoinGlyph, Sprite } from './gameComponents.js';
import { uiUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * How long the round popup holds before it folds away (ms), and the fold: together inside 回合开始's 2 s
 * (server/match/match/common.js DELAYS.ROUND_START), so the 休整期 banner after it never waits or overlaps.
 */
export const ROUND_POPUP_MS = 1700;
const LEAVE_MS = 280;

/** Two-digit round number as the plate shows it (00 before the first round). */
export const roundDigits = (n) => String(Math.max(0, Math.trunc(Number(n) || 0)) % 100).padStart(2, '0');

/**
 * Rounds left before the final assault, for the red strip: 1–3, else null (no strip). `pub.bossRound` is the final
 * assault's round (server/match/match/views.js); the hidden core gets no strip.
 * @param {any} pub m.public
 */
export function roundsToBoss(pub) {
  const r = Math.trunc(Number(pub?.round));
  const b = Math.trunc(Number(pub?.bossRound));
  if (!Number.isFinite(r) || !Number.isFinite(b) || r <= 0) return null;
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

const rsd = (name) => `roundStartDialog/${name}`;
const FACES = ['hudPanel/trans_coop4', 'hudPanel/trans_coop3'];
const ART = ['round_bg', 'round_bg_line', 'round_cross', 'round_frame', 'round_emoji_head', 'round_emoji_body', 'round_emoji_hand',
  'round_emoji_book', 'round_text_01', 'round_sources_icon', 'round_plus', 'round_countdown_bg'].map(rsd).concat(FACES);

/**
 * Fetch the plates' sprites ahead of their first use (screens/game.js, once a match screen opens): a plate lives ≈ 2 s, too
 * short to wait for its images the first time it shows. A missing pack (no ui sprites) fetches nothing.
 */
export function preloadPopupArt() {
  const assets = data.get('assets');
  for (const k of ART) {
    const src = uiUrl(assets, k);
    if (src && typeof Image === 'function') new Image().src = src;
  }
}

/**
 * The plate's left block: the official robot (or the two 联防 faces) in its box — corner crosses, side brackets, the
 * brand line under it.
 */
function PopArt({ faces = false }) {
  const cross = (pos) => html`<i class=${`mpop__x mpop__x--${pos}`}></i>`;
  return html`<div class="mpop__art" aria-hidden="true">
    <${Sprite} k=${rsd('round_bg')} class="mpop__artbg" fallback=${html`<i class="mpop__artbg mpop__artbg--css"></i>`} />
    ${cross('tl')}${cross('tr')}${cross('bl')}${cross('br')}
    <i class="mpop__brk mpop__brk--l"></i><i class="mpop__brk mpop__brk--r"></i>
    ${faces ? html`<span class="mpop__bot mpop__bot--faces">
      ${FACES.map((k, i) => html`<${Sprite} key=${k} k=${k} class=${cx('mpop__face', i && 'mpop__face--2')}
        fallback=${html`<i class=${cx('mpop__face', i && 'mpop__face--2', 'mpop__face--css')}></i>`} />`)}
    </span>` : html`<span class="mpop__bot">
      <${Sprite} k=${rsd('round_emoji_book')} class="mpop__part mpop__part--book" />
      <${Sprite} k=${rsd('round_emoji_body')} class="mpop__part mpop__part--body" />
      <${Sprite} k=${rsd('round_emoji_head')} class="mpop__part mpop__part--head"
        fallback=${html`<i class="mpop__part mpop__part--head mpop__head--css"><i></i><i></i></i>`} />
      <${Sprite} k=${rsd('round_emoji_hand')} class="mpop__part mpop__part--hand" />
      ${[0, 1, 2, 3, 4].map((i) => html`<i key=${i} class=${`mpop__dot mpop__dot--${i}`}></i>`)}
    </span>`}
    <${Sprite} k=${rsd('round_text_01')} class="mpop__tag" fallback=${html`<span class="mpop__tag mpop__tag--css">STRONGHOLD PROTOCOL</span>`} />
  </div>`;
}

/**
 * The plate's root props: round_frame (a white 「[」, 6×33) and round_cross as CSS masks the brackets (box, the cells'
 * labels) and the corner crosses are painted through, tinted like the footage (teal / orange, grey, gold); without the
 * sprites they are CSS borders.
 */
function frameMask() {
  const assets = data.get('assets');
  const frame = uiUrl(assets, rsd('round_frame'));
  const cross = uiUrl(assets, rsd('round_cross'));
  return frame && cross ? { cls: 'has-frame', style: `--mpop-frame:url("${frame}");--mpop-cross:url("${cross}")` } : { cls: null, style: null };
}

/** The plate itself: the contour lines of the official background over a dark translucent panel. */
function Panel({ children }) {
  return html`<div class="mpop__panel">
    <${Sprite} k=${rsd('round_bg_line')} class="mpop__lines" />
    ${children}
  </div>`;
}

/** 剩余 N 回合 with the number picked out (the footage: an orange 3). */
function RoundsLeft({ n }) {
  const [before, after = ''] = t('剩余 {n} 回合', { n: '\u0000' }).split('\u0000');
  return html`<span class="mpop__headtxt">${before}<b class="num">${n}</b>${after}</span>`;
}

/**
 * The round-start plate.
 * @param {{ round: number, gain?: number|null, left?: number|null, sub?: any, watching?: boolean, onDone?: Function }} props
 *   gain: the funds this round start paid (null = not known: the icon without a number)
 *   left: rounds before the final assault (roundsToBoss) — the red strip on top
 *   watching: an eliminated player or a spectator seat — no 获得 cell, `sub` (phaseBanner's 观战中) under the plate
 */
export function RoundPopup({ round, gain = null, left = null, sub = null, watching = false, onDone }) {
  const leaving = useTimedLeave(ROUND_POPUP_MS, onDone);
  const n = !watching && Number.isFinite(gain) && gain > 0 ? Math.trunc(gain) : null;
  const fm = frameMask();
  return html`<div class=${cx('mpop', 'mpop--round', fm.cls, leaving && 'is-leaving')} style=${fm.style} role="status" aria-live="polite"
      aria-label=${t('第 {r} 回合', { r: round })} data-testid="round-popup">
    <${Panel}>
      ${left ? html`<div class="mpop__head" data-testid="round-popup-left">
        <${Sprite} k=${rsd('round_countdown_bg')} class="mpop__headbg" fallback=${html`<i class="mpop__headbg mpop__headbg--css"></i>`} />
        <${RoundsLeft} n=${left} />
      </div>` : null}
      <${PopArt} />
      <div class="mpop__cell mpop__cell--round">
        <span class="mpop__k">${t('回合')}</span>
        <span class="mpop__roll num"><b class="mpop__old">${roundDigits(round - 1)}</b><b class="mpop__new">${roundDigits(round)}</b></span>
      </div>
      ${watching ? null : html`<div class="mpop__cell mpop__cell--gold" data-testid="round-popup-gain">
        <span class="mpop__k">${t('获得')}</span>
        <span class="mpop__gain">
          <i class="mpop__flare" aria-hidden="true"></i>
          <${Sprite} k=${rsd('round_sources_icon')} class="mpop__coin" fallback=${html`<${CoinGlyph} class="mpop__coin mpop__coin--css" />`} />
          ${n ? html`<b class="mpop__plus num">+${n}</b>` : null}
        </span>
        ${n ? [0, 1, 2, 3, 4, 5].map((i) => html`<i key=${i} class="mpop__spark" style=${`--i:${i}`} aria-hidden="true">
          <${Sprite} k=${rsd('round_plus')} fallback=${html`<i class="mpop__spark--css"></i>`} /></i>`) : null}
      </div>`}
    <//>
    ${watching && sub ? html`<div class="mpop__line" data-testid="round-popup-sub">${sub}</div>` : null}
  </div>`;
}

/**
 * A phase plate: the robot or the 联防 faces, title (+ optional line), chevrons sweeping through on the right.
 * @param {{ tone?: 'mint'|'orange'|'red'|'gold', faces?: boolean, title: any, sub?: any, chev?: boolean, duration?: number, onDone?: Function }} props
 */
export function PhasePopup({ tone = 'mint', faces = false, title, sub = null, chev = false, duration = 2200, onDone }) {
  const leaving = useTimedLeave(duration, onDone);
  const fm = frameMask();
  return html`<div class=${cx('mpop', 'mpop--phase', `mpop--${tone}`, fm.cls, chev && 'has-chev', leaving && 'is-leaving')} style=${fm.style} role="status" aria-live="polite"
      data-testid="phase-popup">
    <${Panel}>
      <${PopArt} faces=${faces} />
      <div class="mpop__text">
        <span class="mpop__title">${title}</span>
        ${sub ? html`<span class="mpop__sub">${sub}</span>` : null}
      </div>
      ${chev ? html`<span class="mpop__chevs" aria-hidden="true"><i></i><i></i><i></i></span>` : null}
    <//>
  </div>`;
}

/**
 * The plate a phase starts with (screens/game.js), from its phaseBanner words — or null: 回合开始 has RoundPopup, and
 * the other phases keep the banner (ui/components.js PhaseBanner): the footage shows a plate for 联防 only.
 * @param {string} phase @param {{ title: any, sub?: any } | null} banner
 */
export function phasePopupOf(phase, banner) {
  if (!banner) return null;
  if (phase === 'UNITE') return { tone: 'orange', faces: true, chev: true, duration: 2600, title: banner.title, sub: banner.sub || null };
  return null;
}
