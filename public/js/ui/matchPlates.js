// Turn, boss, elimination and end plates (2026-10-13, the owner's request: the event's video 9:59–10:19, 10:52–10:59
// and 11:03–11:40), original drawings only (ui/pixbots.js):
//   * TurnPopup — 轮到你选: a glowing disc with the winking cube drops onto the 机变 cards when the pick comes round to
//     the player (ui/choiceOverlay.js).
//   * FinalAssaultPlate — 最终攻势: each survivor's LP runs along a line into one node (the merged team LP, its total),
//     then the leader's crest lights up beside it: 合力击败敌方领袖！
//   * HiddenCorePlate — 隐秘核心已解锁 at the hidden round's start: the core crest glitches in red, then settles.
//   * DownedPlate — 协议已失效: the own LP ran out while the team plays on; 继续观战 closes it, 前往结算 asks to leave.
//   * EndPlate — the match's end over the field, before the settlement screen (screens/game.js GameScreen):
//     击败了全部领袖！/ 击败了敌方领袖！/ 未能击破隐秘核心 / 模拟中断 (endPlateOf).
// screens/game.js picks the moments. Styles: css/screens/game.css 首领与结局弹窗. With prefers-reduced-motion they still
// show, without the motion.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { Img, PlayerAvatar, GIcon } from './gameComponents.js';
import { PixBot } from './pixbots.js';
import { useTimedLeave } from './matchPopups.js';
import { sortedPlayers } from './gameLogic.js';
import { enemyIconUrl } from './assetUrls.js';
import { t, tParts } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export const TURN_POPUP_MS = 1300;
export const FINAL_PLATE_MS = 3600;
export const CORE_PLATE_MS = 3000;
/** How long the end plate holds the field before the settlement screen takes over (ms). */
export const END_PLATE_MS = 3400;

/**
 * Which end plate a settlement gets: 'abort' (模拟中断 — a defeat or an abandoned run), 'allClear' (击败了全部领袖！ —
 * the hidden core fought and cleared), 'coreFail' (未能击破隐秘核心 — the leader beaten, the core not), 'clear'
 * (击败了敌方领袖！ — no hidden core). null without a settlement.
 * @param {any} res m.result
 */
export function endPlateOf(res) {
  if (!res || typeof res !== 'object') return null;
  if (!res.victory) return 'abort';
  if (res.hiddenReached) return res.hiddenCleared ? 'allClear' : 'coreFail';
  return 'clear';
}

/**
 * The 最终攻势 plate's rows, frozen when the phase starts: every survivor with the LP it brings, and the merged pool
 * (m.public teamLp; the rows' sum before it arrives).
 * @param {any} pub m.public
 * @returns {{ rows: { player: any, lp: number|null }[], total: number }}
 */
export function finalPlateRows(pub) {
  const rows = sortedPlayers(pub).filter((p) => p && p.alive !== false).map((p) => ({ player: p, lp: Number.isFinite(p.lp) ? p.lp : null }));
  const sum = rows.reduce((s, r) => s + Math.max(0, r.lp || 0), 0);
  return { rows, total: Number.isFinite(pub?.teamLp) ? pub.teamLp : sum };
}

/** A leader's portrait (the enemy icon of bosses.json's enemyKey), or null. */
export function bossIconOf(gd, bossId) {
  const b = bossId && gd?.boss ? gd.boss(bossId) : null;
  return b?.enemyKey ? enemyIconUrl(gd.m, b.enemyKey) : null;
}

/**
 * The lines of the 最终攻势 plate in its 1240 × 400 design box: one per survivor row (centred on the node's height), from
 * the row's LP to the node's left edge, fanned a little where they meet. Rows close up past four (a 10-seat room).
 * @param {number} n rows
 * @returns {{ y: number, d: string, gap: number }[]}
 */
export function finalLines(n) {
  const k = Math.max(0, Math.trunc(n) || 0);
  const gap = k > 1 ? Math.min(88, Math.floor(320 / (k - 1))) : 88;
  const top = FA_NODE.y - ((k - 1) * gap) / 2;
  return Array.from({ length: k }, (_, i) => {
    const y = Math.round(top + i * gap);
    const ey = Math.round(FA_NODE.y + (i - (k - 1) / 2) * Math.min(10, 40 / Math.max(1, k - 1)));
    return { y, gap, d: `M424 ${y} C508 ${y} 500 ${ey} 572 ${ey}` };
  });
}
const FA_NODE = { x: 620, y: 165 };
const rem = (px) => `${px / 100}rem`;

/**
 * A crest: the pixel mask, a glow behind it, the leader's own portrait in a ring at its foot, and a ✓ / ✕ badge.
 * @param {{ kind?: 'leader'|'core', icon?: string|null, mark?: 'done'|'fail'|null, class?: string }} props
 */
export function Crest({ kind = 'leader', icon = null, mark = null, class: cls }) {
  return html`<span class=${cx('crest', `crest--${kind}`, mark && `is-${mark}`, cls)} aria-hidden="true">
    <i class="crest__glow"></i>
    <${PixBot} kind=${kind === 'core' ? 'core' : 'crest'} class="crest__pix" />
    ${icon ? html`<span class="crest__icon"><${Img} src=${icon} /></span>` : null}
    ${mark ? html`<span class="crest__mark"><${Icon} name=${mark === 'done' ? 'check' : 'close'} /></span>` : null}
  </span>`;
}

/** 轮到你选: the disc drops in over the cards, holds a beat and fades. */
export function TurnPopup({ onDone }) {
  const leaving = useTimedLeave(TURN_POPUP_MS, onDone);
  return html`<div class=${cx('turnpop', leaving && 'is-leaving')} role="status" aria-live="assertive" data-testid="turn-popup">
    <div class="turnpop__disc">
      <i class="turnpop__ring" aria-hidden="true"></i>
      <i class="turnpop__x turnpop__x--tl"></i><i class="turnpop__x turnpop__x--tr"></i><i class="turnpop__x turnpop__x--bl"></i><i class="turnpop__x turnpop__x--br"></i>
      <${PixBot} kind="cube" class="turnpop__cube" />
      <b class="turnpop__title">${t('轮到你选')}</b>
      <span class="turnpop__bar" aria-hidden="true">YOUR TURN // DECIDE</span>
    </div>
  </div>`;
}

/**
 * 最终攻势: the survivors' LP merging into the team's pool, then the leader.
 * @param {{ rows: { player: any, lp: number|null }[], total: number|null, icon?: string|null, onDone?: Function }} props
 */
export function FinalAssaultPlate({ rows, total, icon = null, onDone }) {
  const leaving = useTimedLeave(FINAL_PLATE_MS, onDone);
  const lines = finalLines(rows.length);
  return html`<div class=${cx('bplate', 'bplate--final', leaving && 'is-leaving')} role="status" aria-live="polite"
      aria-label=${t('最终攻势：合力击败敌方领袖！')} data-testid="final-plate">
    <div class="bplate__panel">
      <i class="bplate__ink" aria-hidden="true"></i><i class="bplate__grid" aria-hidden="true"></i>
      <i class="bplate__x bplate__x--tl"></i><i class="bplate__x bplate__x--tr"></i><i class="bplate__x bplate__x--bl"></i><i class="bplate__x bplate__x--br"></i>
      <svg class="fa__lines" viewBox="0 0 1240 400" aria-hidden="true">
        ${lines.map((l, i) => html`<g key=${i} style=${`--i:${i}`}>
          <path class="fa__line" d=${l.d} pathLength="1" />
          <path class="fa__comet" d=${l.d} pathLength="1" />
        </g>`)}
      </svg>
      ${rows.map((r, i) => html`<div key=${r.player?.playerId ?? i} class="fa__row" style=${`top:${rem(lines[i].y)};--i:${i};--fa-av:${rem(Math.min(66, lines[i].gap - 10))}`}>
        <${PlayerAvatar} player=${r.player} size="sm" class="fa__ava" />
        <span class="fa__lp num"><${Icon} name="rook" />${Number.isFinite(r.lp) ? Math.max(0, r.lp) : '--'}</span>
      </div>`)}
      <div class="fa__node" style=${`left:${rem(FA_NODE.x)};top:${rem(FA_NODE.y)}`}>
        <i class="fa__ring" aria-hidden="true"></i><i class="fa__pulse" aria-hidden="true"></i>
        <span class="fa__box"><${Icon} name="rook" /><b class="fa__total num">${Number.isFinite(total) ? Math.max(0, total) : '--'}</b></span>
      </div>
      <div class="fa__words">
        <span class="fa__micro">${t('最终攻势')}</span>
        <b class="fa__title">${t('合力击败敌方领袖！')}</b>
      </div>
      <span class="fa__crestwrap"><i class="fa__burst" aria-hidden="true"></i><${Crest} kind="leader" icon=${icon} class="fa__crest" /></span>
    </div>
  </div>`;
}

/**
 * 隐秘核心已解锁: the hidden round begins.
 * @param {{ icon?: string|null, onDone?: Function }} props
 */
export function HiddenCorePlate({ icon = null, onDone }) {
  const leaving = useTimedLeave(CORE_PLATE_MS, onDone);
  return html`<div class=${cx('bplate', 'bplate--core', leaving && 'is-leaving')} role="status" aria-live="polite" data-testid="core-plate">
    <div class="bplate__panel">
      <i class="bplate__ink" aria-hidden="true"></i><i class="bplate__grid" aria-hidden="true"></i>
      <i class="bplate__x bplate__x--tl"></i><i class="bplate__x bplate__x--tr"></i><i class="bplate__x bplate__x--bl"></i><i class="bplate__x bplate__x--br"></i>
      <i class="core__warn core__warn--l" aria-hidden="true"></i><i class="core__warn core__warn--r" aria-hidden="true"></i>
      <span class="core__crestwrap">
        <${Crest} kind="core" icon=${icon} class="core__ghost core__ghost--a" />
        <${Crest} kind="core" icon=${icon} class="core__ghost core__ghost--b" />
        <${Crest} kind="core" icon=${icon} class="core__crest" />
      </span>
      <div class="core__words">
        <b class="core__title">${t('隐秘核心已解锁')}</b>
        <span class="core__sub">${t('挑战失败不影响最终结算')}</span>
      </div>
    </div>
  </div>`;
}

/**
 * 协议已失效: the own LP ran out. 继续观战 (or Esc) closes it; 前往结算 hands over to the exit flow.
 * @param {{ onWatch: Function, onSettle: Function }} props
 */
export function DownedPlate({ onWatch, onSettle }) {
  const [out, setOut] = useState(false);
  const watchRef = useRef(null);
  useEffect(() => {
    const id = setTimeout(() => setOut(true), 560);
    const focus = setTimeout(() => watchRef.current?.focus?.(), 900);
    const onKey = (e) => { if (e.key === 'Escape') onWatch(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); clearTimeout(focus); window.removeEventListener('keydown', onKey); };
  }, []);
  return html`<div class="downpl" role="dialog" aria-modal="true" aria-label=${t('协议已失效')} data-testid="downed-plate">
    <i class="downpl__veil" aria-hidden="true"></i>
    <div class="downpl__band">
      <i class="downpl__line downpl__line--l" aria-hidden="true"></i><i class="downpl__line downpl__line--r" aria-hidden="true"></i>
      <div class="downpl__panel">
        <i class="bplate__ink" aria-hidden="true"></i><i class="bplate__grid" aria-hidden="true"></i>
        <i class="downpl__tick downpl__tick--a" aria-hidden="true"></i><i class="downpl__tick downpl__tick--b" aria-hidden="true"></i>
        <span class=${cx('downpl__face', out && 'is-out')} aria-hidden="true">
          <${PixBot} kind=${out ? 'downed' : 'calm'} class="downpl__pix" />
          <small>PROTOCOL // LOST</small>
        </span>
        <span class="downpl__words">
          <b class="downpl__title">${t('协议已失效')}</b>
          <small class="downpl__sub"><i aria-hidden="true"></i>STRONGHOLD PROTOCOL</small>
        </span>
      </div>
      <div class="downpl__btns">
        <button type="button" ref=${watchRef} class="downpl__btn downpl__btn--watch" onClick=${onWatch}><${GIcon} name="eye" />${t('继续观战')}</button>
        <button type="button" class="downpl__btn downpl__btn--settle" onClick=${onSettle}><${Icon} name="exit" />${t('前往结算')}</button>
      </div>
    </div>
  </div>`;
}

/**
 * The match's end over the field (endPlateOf kinds). It holds until screens/game.js swaps in the settlement screen;
 * `leaving` fades it out first.
 * @param {{ kind: 'allClear'|'clear'|'coreFail'|'abort', leaderIcon?: string|null, coreIcon?: string|null, leaving?: boolean }} props
 */
export function EndPlate({ kind, leaderIcon = null, coreIcon = null, leaving = false }) {
  const win = kind === 'allClear' || kind === 'clear';
  let body;
  if (kind === 'abort') {
    body = html`<span class="endpl__slash" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
      <span class="endpl__words endpl__words--side">
        <b class="endpl__title">${t('模拟中断')}</b>
        <small class="endpl__sub"><i aria-hidden="true"></i>STRONGHOLD PROTOCOL</small>
      </span>`;
  } else {
    const crests = kind === 'clear'
      ? html`<${Crest} kind="leader" mark="done" class="endpl__crest" />`
      : html`<${Crest} kind="leader" mark=${kind === 'coreFail' ? 'done' : null} class=${cx('endpl__crest', kind === 'coreFail' && 'is-dim')} />
          <${Crest} kind="core" mark=${kind === 'coreFail' ? 'fail' : null} class="endpl__crest endpl__crest--core" />`;
    const title = kind === 'allClear' ? tParts('击败了{who}！', { who: html`<em>${t('全部领袖')}</em>` })
      : kind === 'clear' ? tParts('击败了{who}！', { who: html`<em>${t('敌方领袖')}</em>` })
      : t('未能击破隐秘核心');
    body = html`<span class="endpl__row">
        ${leaderIcon ? html`<span class="endpl__ava endpl__ava--l"><${Img} src=${leaderIcon} /></span>` : null}
        <span class="endpl__crests">${crests}${kind === 'allClear' ? html`<span class="endpl__badge"><${Icon} name="check" /></span>` : null}</span>
        ${coreIcon && kind !== 'clear' ? html`<span class="endpl__ava endpl__ava--r"><${Img} src=${coreIcon} /></span>` : null}
      </span>
      <b class="endpl__title">${title}</b>`;
  }
  return html`<div class=${cx('endpl', `endpl--${kind}`, win && 'is-win', leaving && 'is-leaving')} role="status" aria-live="polite" data-testid="end-plate">
    <i class="endpl__veil" aria-hidden="true"></i>
    <div class="endpl__panel">
      <i class="bplate__ink" aria-hidden="true"></i><i class="bplate__grid" aria-hidden="true"></i>
      <i class="endpl__side endpl__side--l" aria-hidden="true"></i><i class="endpl__side endpl__side--r" aria-hidden="true"></i>
      ${body}
    </div>
  </div>`;
}
