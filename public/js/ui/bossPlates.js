// The leader rounds' plates and the run's end, as the event's footage shows them (video 11:03–11:08 最终攻势,
// 11:25–11:28 隐秘核心已解锁, 11:30–11:39 the endings), drawn with the official sprites (data/assets.json ui): the
// leader crest settle/round_info_boss_icon, the hidden core's round_info_boss_icon_sp, their ✓ round_info_boss_complete
// (_sp), the merged-LP node's rook hudPanel/icon_hp, the warnings hudPanel/icon_warn and the map behind the panel
// settle/settlemen_personal_fail; the leaders' portraits are their enemy icons. Those settle crests are small (the
// emblem is ~28 / 45 px): when the local client's extract is there (data/local-assets.json ui/battle, tools/local-
// extract) the crests are its full-size sprites instead — icon_boss_normal_white (tinted the crest's orange, as the
// footage draws it flat) and boss_sp_icon, the hidden core's glitched crest (Crest).
//   * FinalAssaultPlate — 最终攻势: each survivor's LP runs along a line into one node (the team's merged LP, m.public
//     teamLp), then the leader's crest lights up beside it: 合力击败敌方领袖！
//   * HiddenCorePlate — 隐秘核心已解锁 at the hidden round's start.
//   * EndPlate — the run's end, in the 3 s the server already waits before RESULT (server/match/match/bossRounds.js
//     DELAYS.SETTLE; settle.js afterSettle) — it never delays the settlement: 击败了全部领袖！ / 未能击破隐秘核心 when
//     the hidden round is over, 模拟中断 when the team falls (endPlateOf).
// screens/game.js picks the moments, and shows them only once every sprite is in (bossPlateArtReady): without the art
// pack the 0.3.0 banners stay. pointer-events none: the field stays usable. With prefers-reduced-motion they show
// without the motion. Styles: css/screens/boss-plates.css. [ASSUMED] the positions, sizes and timings, measured frame by
// frame from that footage.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { Img, PlayerAvatar } from './gameComponents.js';
import { uiUrl, enemyIconUrl } from './assetUrls.js';
import { reducedMotion } from './device.js';
import { sortedPlayers } from './gameLogic.js';
import { data, getBoss, localAsset } from '../data.js';
import { PHASE } from '../../../shared/constants.js';
import { t, tParts } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** How long each plate holds before it fades (ms; the fade is LEAVE_MS more). */
export const FINAL_PLATE_MS = 3300;
export const CORE_PLATE_MS = 2500;
export const END_PLATE_MS = 2500;
const LEAVE_MS = 250;

const ART = ['settle/round_info_boss_icon', 'settle/round_info_boss_icon_sp', 'settle/round_info_boss_complete',
  'settle/round_info_boss_complete_sp', 'settle/settlemen_personal_fail', 'hudPanel/icon_hp', 'hudPanel/icon_warn'];

/** Whether every sprite has loaded (preloadBossPlateArt): null = not fetched yet, false = missing or still loading. */
let plateArt = null;

/** The full-size crests (Crest): null = not fetched yet (the local manifest may come later), false = none, true = in. */
const HD = { leader: 'icon_boss_normal_white', core: 'boss_sp_icon' };
let hdArt = null;

function preloadHdCrests() {
  if (hdArt !== null || typeof Image !== 'function' || !data.get('local')) return;
  const urls = [HD.leader, HD.core].map((n) => localAsset('ui/battle', n));
  hdArt = false;
  if (!urls.every(Boolean)) return;
  let left = urls.length;
  for (const src of urls) {
    const img = new Image();
    img.onload = () => { left -= 1; if (left === 0) hdArt = true; };
    img.onerror = () => { left = -1; };
    img.src = src;
  }
}

/** True once the sprites are all in: without them screens/game.js keeps the 0.3.0 banners and result box. */
export const bossPlateArtReady = () => { preloadHdCrests(); return plateArt === true; };

/** Fetch the sprites when the match screen opens (screens/game.js, once per page). A missing pack never turns ready. */
export function preloadBossPlateArt() {
  if (plateArt !== null || typeof Image !== 'function') return;
  plateArt = false;
  const assets = data.get('assets');
  const urls = ART.map((k) => uiUrl(assets, k));
  if (!urls.every(Boolean)) return;
  let left = urls.length;
  for (const src of urls) {
    const img = new Image();
    img.onload = () => { left -= 1; if (left === 0) plateArt = true; };
    img.onerror = () => { left = -1; };
    img.src = src;
  }
}

/**
 * Whether a leader round's battles are over: the server zeroes the countdown and stops every field, then waits
 * DELAYS.SETTLE before the next round or RESULT (server/match/match/bossRounds.js); a leader at 0 HP is over at once.
 * @param {any} pub m.public
 */
export function bossRoundOver(pub) {
  if (!pub?.bossHp) return false;
  if (Number(pub.bossHp.hp) <= 0) return true;
  const fields = Array.isArray(pub.fields) ? pub.fields : [];
  return !pub.deadline && fields.length > 0 && fields.every((f) => !f.live);
}

/**
 * Which end plate the moment calls for, or null:
 *   'allClear' — the hidden round is over and its leader fell (击败了全部领袖！);
 *   'coreFail' — the hidden round is over, its leader standing (未能击破隐秘核心: the run is still won);
 *   'abort'    — 模拟中断: the 最终攻势 is over with the leader standing, or the round's settlement left nobody alive.
 * A 最终攻势 won goes on to the hidden round or to the settlement as in 0.3.0 [ASSUMED: the footage has no plate for it].
 * @param {string} phase @param {any} pub m.public
 * @returns {'allClear'|'coreFail'|'abort'|null}
 */
export function endPlateOf(phase, pub) {
  if (phase === PHASE.HIDDEN_CORE && bossRoundOver(pub)) return Number(pub.bossHp.hp) <= 0 ? 'allClear' : 'coreFail';
  if (phase === PHASE.FINAL_ASSAULT && bossRoundOver(pub) && Number(pub.bossHp.hp) > 0) return 'abort';
  // [ASSUMED] the settlement that eliminates the last player shows 模拟中断 in place of the round's result box
  const players = Array.isArray(pub?.players) ? pub.players : [];
  if (phase === PHASE.SETTLE && players.length > 0 && players.every((p) => p.alive === false)) return 'abort';
  return null;
}

/**
 * The 最终攻势 plate's rows, frozen when the phase starts: every survivor with the LP it brings (seat order), and the
 * merged pool (m.public teamLp; the rows' sum before it arrives).
 * @param {any} pub m.public
 * @returns {{ rows: { player: any, lp: number }[], total: number }}
 */
export function finalPlateRows(pub) {
  const rows = sortedPlayers(pub).filter((p) => p && p.alive !== false).map((p) => ({ player: p, lp: Math.max(0, Number(p.lp) || 0) }));
  const sum = rows.reduce((s, r) => s + r.lp, 0);
  return { rows, total: Number.isFinite(pub?.teamLp) ? Math.max(0, pub.teamLp) : sum };
}

/** The rows' heights in the plate (design px from its top), centred on the node; closer together past four. */
export function finalRowsY(n) {
  const k = Math.max(0, Math.trunc(n) || 0);
  const gap = k > 4 ? Math.floor(312 / (k - 1)) : 104;
  return Array.from({ length: k }, (_, i) => Math.round(NODE_Y + (i - (k - 1) / 2) * gap));
}
const NODE_Y = 202;

/** A leader's portrait (the enemy icon of bosses.json's enemyKey), or null. */
export function bossIconOf(bossId) {
  const b = bossId ? getBoss(bossId) : null;
  return b?.enemyKey ? enemyIconUrl(data.get('assets'), b.enemyKey) : null;
}

function Art({ k, class: cls }) {
  const src = uiUrl(data.get('assets'), k);
  return src ? html`<img class=${cls} src=${src} alt="" draggable="false" />` : null;
}

/**
 * A leader's crest: the local client's full-size sprite once loaded, else the settle one. The orange crest is the
 * white sprite as a mask (the footage's flat orange), so the beaten crest's filter still turns it black.
 * @param {{ core?: boolean, class?: string }} props
 */
function Crest({ core = false, class: cls }) {
  const hd = hdArt === true ? localAsset('ui/battle', core ? HD.core : HD.leader) : null;
  if (!hd) return html`<${Art} k=${core ? 'settle/round_info_boss_icon_sp' : 'settle/round_info_boss_icon'} class=${cls} />`;
  if (core) return html`<img class=${cx(cls, 'is-hd')} src=${hd} alt="" draggable="false" />`;
  return html`<i class=${cx(cls, 'is-hd', 'bpl__crest--tint')} style=${`--crest: url("${hd}")`}></i>`;
}

/** Hold for `ms`, then `leaving` (the fade), then onDone. */
function useTimedLeave(ms, onDone) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setLeaving(true), ms);
    const b = setTimeout(() => onDone?.(), ms + LEAVE_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  return leaving;
}

/** `to` counted up from 0 over `ms` after `delay` (the node filling with the team's LP); at once with reduced motion. */
function useCountUp(to, delay, ms) {
  const [n, setN] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (reducedMotion()) { setN(to); return undefined; }
    const steps = 9;
    const ids = Array.from({ length: steps }, (_, i) => setTimeout(() => setN(Math.round((to * (i + 1)) / steps)), delay + (ms * (i + 1)) / steps));
    return () => ids.forEach(clearTimeout);
  }, [to]);
  return n;
}

const px = (n) => `calc(${n} * var(--px))`;

/** A leader's portrait in its ring, with the official ✓ when it fell. */
function Portrait({ src, done = false, core = false, class: cls }) {
  return html`<span class=${cx('bpl__ava', core && 'bpl__ava--core', cls)}>
    <${Img} src=${src} />
    ${done ? html`<${Art} k=${core ? 'settle/round_info_boss_complete_sp' : 'settle/round_info_boss_complete'} class="bpl__done" />` : null}
  </span>`;
}

/**
 * 最终攻势: the survivors' LP merging into the team's pool, then the leader.
 * @param {{ rows: { player: any, lp: number }[], total: number, bossId?: string|null, myId?: string|null, onDone?: Function }} props
 */
export function FinalAssaultPlate({ rows, total, bossId = null, myId = null, onDone }) {
  const leaving = useTimedLeave(FINAL_PLATE_MS, onDone);
  const shown = useCountUp(total, 700, 450);
  const ys = finalRowsY(rows.length);
  return html`<div class=${cx('bpl', 'bpl--final', leaving && 'is-leaving')} role="status" aria-live="polite"
      aria-label=${`${t('最终攻势')}：${t('合力击败敌方领袖！')}`} data-testid="final-plate">
    <div class="bpl__panel">
      <${Art} k="settle/settlemen_personal_fail" class="bpl__map" />
      <div class="fa__group">
        <svg class="fa__lines" viewBox="0 0 1360 430" aria-hidden="true">
          ${ys.map((y, i) => {
            const d = `M260 ${y} C440 ${y} 430 ${NODE_Y} 612 ${NODE_Y}`;
            return html`<g key=${i} style=${`--i:${i}`}><path class="fa__line" d=${d} pathLength="1" /><path class="fa__comet" d=${d} pathLength="1" /></g>`;
          })}
        </svg>
        ${rows.map((r, i) => html`<div key=${r.player?.playerId ?? i} class="fa__row" style=${`top:${px(ys[i] - 45)};--i:${i}`}>
          <${PlayerAvatar} player=${r.player} self=${r.player?.playerId === myId} class="fa__ava" />
          <span class="fa__lp num">${r.lp}</span>
        </div>`)}
        <div class="fa__node" aria-hidden="true">
          <i class="fa__ring fa__ring--o"></i><i class="fa__ring fa__ring--i"></i>
          <span class="fa__box"><${Art} k="hudPanel/icon_hp" class="fa__rook" /><b class="fa__total num">${shown}</b></span>
        </div>
        <div class="fa__words">
          <span class="fa__micro">${t('最终攻势')}</span>
          <b class="fa__title">${t('合力击败敌方领袖！')}</b>
        </div>
      </div>
      <div class="fa__leader" aria-hidden="true">
        <${Crest} class="bpl__crest" />
        <${Portrait} src=${bossIconOf(bossId)} class="fa__boss" />
      </div>
    </div>
  </div>`;
}

/**
 * 隐秘核心已解锁: the hidden round begins.
 * @param {{ bossId?: string|null, onDone?: Function }} props
 */
export function HiddenCorePlate({ bossId = null, onDone }) {
  const leaving = useTimedLeave(CORE_PLATE_MS, onDone);
  return html`<div class=${cx('bpl', 'bpl--core', leaving && 'is-leaving')} role="status" aria-live="polite" data-testid="core-plate">
    <div class="bpl__panel">
      <${Art} k="settle/settlemen_personal_fail" class="bpl__map" />
      <i class="core__beam core__beam--l" aria-hidden="true"></i><i class="core__beam core__beam--r" aria-hidden="true"></i>
      <${Art} k="hudPanel/icon_warn" class="core__warn core__warn--a" /><${Art} k="hudPanel/icon_warn" class="core__warn core__warn--b" />
      <${Art} k="hudPanel/icon_warn" class="core__warn core__warn--c" />
      <i class="core__halo" aria-hidden="true"></i>
      <span class="core__crest" aria-hidden="true">
        <${Crest} core=${true} class="bpl__crest core__ghost" />
        <${Crest} core=${true} class="bpl__crest" />
      </span>
      <${Portrait} src=${bossIconOf(bossId)} core=${true} class="core__boss" />
      <b class="core__title">${t('隐秘核心已解锁')}</b>
      <span class="core__sub">${t('挑战失败不影响最终结算')}</span>
    </div>
  </div>`;
}

/**
 * The run's end (endPlateOf kinds), over the field in the server's last pause before RESULT.
 * @param {{ kind: 'allClear'|'coreFail'|'abort', bossId?: string|null, hiddenBossId?: string|null, onDone?: Function }} props
 */
export function EndPlate({ kind, bossId = null, hiddenBossId = null, onDone }) {
  const leaving = useTimedLeave(END_PLATE_MS, onDone);
  let body;
  if (kind === 'abort') {
    body = html`<span class="end__bars" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map((i) => html`<i key=${i} style=${`--i:${i}`}></i>`)}</span>
      <b class="end__title end__title--side">${t('模拟中断')}</b>
      <span class="end__sub" aria-hidden="true">STRONGHOLD PROTOCOL</span>`;
  } else {
    const all = kind === 'allClear';
    body = html`<span class="end__row" aria-hidden="true">
        <${Portrait} src=${bossIconOf(bossId)} done=${true} class="end__ava" />
        <span class=${cx('end__crest', !all && 'is-beaten')}><${Crest} class="bpl__crest" />
          ${!all ? html`<${Art} k="settle/round_info_boss_complete" class="end__mark" />` : null}</span>
        <span class="end__crest end__crest--core"><${Crest} core=${true} class="bpl__crest" /></span>
        <${Portrait} src=${bossIconOf(hiddenBossId)} core=${true} done=${all} class="end__ava" />
      </span>
      <b class="end__title">${all ? tParts('击败了{who}！', { who: html`<em>${t('全部领袖')}</em>` }) : t('未能击破隐秘核心')}</b>`;
  }
  return html`<div class=${cx('bpl', 'bpl--end', `end--${kind}`, leaving && 'is-leaving')} role="status" aria-live="polite" data-testid="end-plate">
    <div class="bpl__panel">
      ${kind !== 'coreFail' ? html`<${Art} k="settle/settlemen_personal_fail" class="bpl__map" />` : null}
      ${body}
    </div>
  </div>`;
}
