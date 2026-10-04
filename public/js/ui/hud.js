// In-match top bar (research 06 §11.1): exit + ping (left); round box, phase capsule (prep label /
// kills n/m / boss HP bar), LP tower, match-info and enemy-preview buttons (centre, bracket frame);
// 7-segment countdown with gauge and the 准备就绪 toggle (right).
// The two 🔍 buttons follow the official HUD bindings (research 09 §2.1 / §6.2 item 3):
//   left  btn_check_player  — mint [🔍] opens the 本局信息 dialog (ui/enemyDrawer.js; its 敌方情报 tab is the secondary
//                             enemy list); in the pen view it becomes [🔍◀◀] (btn_check_player_back) and returns the camera;
//   right btn_check_enemy   — amber [🔍▶▶] pans the camera to the enemy preview pen (休整期 only); in the pen view (and
//                             outside prep) it is the grey [🔍] (btn_check_enemy_unfold) — pressing it in the pen returns too.
// Official sprites (local ui/battle extraction) when installed, CSS look-alikes otherwise.
// Boss rounds (最终攻势 / 隐秘核心): the countdown is the level's 120 s maxPlayTime (m.public.deadline, gauge total from
// gameLogic phaseTotalSeconds) and the red DOT overtime warning under it keys off m.public.overtimeAt (ui/matchStatus.js
// overtimeState): "NN 秒后全队生命值开始流失" once the level time ran out, then a live "生命值 −1/秒" indicator while the
// merged team LP drains (the LP tower turns red). Solo battles: a pause / resume button beside the countdown (g.pause);
// while m.public.paused every clock here is frozen at the pause moment (`frozenAt`).
// Normal rounds (user playtest #3 item 2): the LP tower drops live as the own battle's enemies enter the blue gate —
// lp − min(lpCapPerRound, counted leaks) in red with a −N tick, 联防中 while a 联防 may still save part of it (liveLp;
// the leaks come from the local battle runner, else m.public players[].pendingLp). 联防 (user playtest #6 item 7; PRTS
// 卫戍协议/帮助 "防卫失败的玩家可通过上方信息栏确认自身所属敌人的剩余数量"): a leaker's phase capsule carries the official
// runner tag ×N (research 09 `tag_miss`; art ui/battle bg_miss_enemy [ASSUMED]) = its enemies still standing on the 联防
// field, uncapped and live — falling as the helpers kill them, rising when one splits or summons (the local 联防
// replica's runner state().uniteLeft, else m.public players[].uniteLeft); the LP tower shows lp − min(lpCapPerRound, N).
// The same MissTag sits in the leakers' team rows (ui/teamPanel.js), its tooltip naming the teammate there (missTip).
// 准备就绪 is refused while the temp overflow row (临时整备区) holds pieces: the reason shows under the button
// (user playtest #3 item 3; the row's own label is ui/underframe.js TempRowNotice).

import { useRef } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { html, Button, Icon, PingPill, Countdown, Tooltip, MicroLabel, DifficultyTag, useTicker } from './components.js';
import { Sprite, LpTower, GIcon, LocalSprite } from './gameComponents.js';
import { localAsset } from '../data.js';
import { serverNow } from '../store.js';
import { isCombatPhase, isBossPhase, prepCapsuleLabel, bossFrac, bossPctText, fmtNum, shopBlockReason } from './gameLogic.js';
import { overtimeState, overtimeDrainPerSec, remainAt } from './matchStatus.js';
import { T, TH } from '../i18n.js';
const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * Phase capsule: prep label, kills n/m (combat/unite), kills + boss HP bar (boss rounds).
 * @param {{ pub:any, hud:any }} props
 */
export function PhaseCapsule({ pub, hud, miss = null }) {
  const phase = pub?.phase;
  if (isBossPhase(phase)) {
    // the battle on screen first: its snapshot carries the live pool (the local simulation's own damage on top of the
    // server's b.pool, or the server's 20 Hz stream); m.public.bossHp refreshes at ~1 Hz and lags the leader's death
    const boss = hud?.boss || pub.bossHp || null;
    const frac = bossFrac(boss);
    return html`<div class="capsule capsule--boss" role="status">
      <${Sprite} k="hudPanel/icon_boss" class="capsule__icon" fallback=${html`<${GIcon} name="skull" class="capsule__icon" />`} />
      ${hud?.total != null ? html`<span class="capsule__kills num"><b>${hud.killed ?? 0}</b>/${hud.total}</span>` : null}
      <div class="bossbar" title=${boss ? `${fmtNum(boss.hp)} / ${fmtNum(boss.max)}` : T('敌方领袖')}>
        <div class="bossbar__fill" style=${`width:${frac == null ? 100 : frac * 100}%`}></div>
        <span class="bossbar__txt num">${frac == null ? T('敌方领袖') : bossPctText(frac)}</span>
      </div>
    </div>`;
  }
  if (isCombatPhase(phase) || (phase === PHASE.SETTLE && hud?.total != null)) {
    return html`<div class=${cx('capsule', 'capsule--combat', phase === PHASE.UNITE && 'capsule--unite')} role="status">
      <${Sprite} k=${phase === PHASE.UNITE ? 'hudPanel/icon_coop' : 'hudPanel/icon_battle'} class="capsule__icon"
        fallback=${html`<${Icon} name="sword" class="capsule__icon" />`} />
      <span class="capsule__kills num"><b>${hud?.killed ?? 0}</b>/${hud?.total ?? '--'}</span>
      ${phase === PHASE.UNITE ? html`<span class="capsule__tag">${T('联防')}</span>` : null}
      ${phase === PHASE.UNITE && Number.isFinite(miss) ? html`<${MissTag} n=${miss} />` : null}
    </div>`;
  }
  return html`<div class="capsule capsule--prep" role="status">
    <${Sprite} k="hudPanel/icon_rest" class="capsule__icon" fallback=${html`<${Icon} name="rook" class="capsule__icon" />`} />
    <span class="capsule__label">${prepCapsuleLabel(phase)}</span>
  </div>`;
}

/**
 * Tooltip of a MissTag: the own tag speaks to the player ("你漏过的…"), a teammate's row names that teammate (the viewer
 * may be one of the helpers fighting those enemies).
 * @param {number} n enemies still standing @param {string|null} [name] the leaker's name (null = the viewer)
 */
export function missTip(n, name = null) {
  const who = name ? T('{0} 漏过的敌人', name) : T('你漏过的敌人');
  return n > 0 ? T('{0}还剩 {1} 个（{2}）', who, n, name ? T('联防中') : T('队友正在迎战')) : T('{0}已全部被击倒', who);
}

/**
 * The official escaped-enemy tag (research 09: the 联防 capsule's orange runner tag ×N, node `tag_miss`; drawn with
 * ui/battle `bg_miss_enemy` — [ASSUMED] that sprite is its art: an orange pill with a runner and ×, the number after it):
 * during 联防 a leaker's enemies still standing on the 联防 field (user playtest #6 item 7) — the own in the phase capsule
 * and the own team row, a teammate's in that teammate's row (`name`). CSS look-alike without the art.
 * @param {{ n: number, name?: string|null }} props name: the leaker's name on a teammate's row (null = the viewer)
 */
export function MissTag({ n, name = null }) {
  const v = Math.max(0, Math.trunc(Number(n) || 0));
  const art = localAsset('ui/battle', 'bg_miss_enemy');
  return html`<span class=${cx('misstag', art && 'has-art', v === 0 && 'is-clear')} data-testid="miss-tag"
      title=${missTip(v, name)} aria-label=${T('剩余敌人 {0}', v)}
      style=${art ? `background-image:url("${art}")` : null}>
    ${art ? null : html`<span class="misstag__icon" aria-hidden="true"><${GIcon} name="skull" />×</span>`}<b class="misstag__n num">${v}</b>
  </span>`;
}

// ---- live LP of the own battle (user playtest #3 item 2) --------------------------------------------------------

/** Phases whose leaks are still to be charged at settlement (normal rounds: the own battle, then 联防). */
const LEAK_PHASES = new Set([PHASE.COMBAT, PHASE.UNITE]);

/**
 * LP a round's leaks cost at settlement — the server rule (server/match/Match.js settle): min(lpCapPerRound, counted
 * leaks), never negative.
 * @param {number} leaks counted leaks so far
 * @param {number} [cap] data/config.json lpCapPerRound
 */
export function pendingLoss(leaks, cap = 10) {
  const n = Math.max(0, Math.trunc(Number(leaks) || 0));
  const c = Number(cap) > 0 ? Math.trunc(Number(cap)) : 10;
  return Math.min(c, n);
}

/**
 * Counted leaks of the own battle so far from its two sources: the local runner's count (state().leaks of the own
 * field — authoritative or a display replica) and the server's m.public players[].pendingLp (the authority's b.progress,
 * ~1 Hz; the recorded result in 联防). Both only grow during a round, so the further one wins: a display replica stands
 * still while the player watches a teammate's field (the server's count moves on), the server's lags the local one by
 * up to a second. Missing / invalid values count as 0.
 * @param {any} local @param {any} server
 */
export function ownLeaks(local, server) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
  return Math.max(n(local), n(server));
}

/**
 * A leaker's enemies still standing on the 联防 field from its two sources (user playtest #6 item 7): the local 联防
 * replica's count (runner state().uniteLeft[own id] — the same deterministic battle the player is watching, so the tag
 * matches the field on screen) and the server's m.public players[].uniteLeft (the authority's b.progress, ~1 Hz; exact
 * once the field is done). The count falls as the helpers strike enemies down and rises when one splits or summons, so
 * neither source bounds the other: the replica wins while it runs, the server's value fills in without one (not loaded
 * yet, not on screen). null when neither is known (not a leaker, or nothing yet).
 * @param {any} local @param {any} server
 * @returns {number|null}
 */
export function uniteRemaining(local, server) {
  for (const v of [local, server]) if (Number.isFinite(v) && v >= 0) return Math.trunc(v);
  return null;
}

/**
 * The own LP while a normal round's battle runs: the loss its counted leaks will cost is shown at once (red, −N)
 * instead of only at settlement. `base` — kept by the caller between renders — is the settled m.private state the
 * pending loss applies to: { round, lp, statsLeaks } as first seen in the round's COMBAT / 联防. The pending part is
 * dropped as soon as the settlement lands — m.private lp or stats.leaks changed (Match.flush sends m.private before the
 * SETTLE m.public) — or the phase leaves COMBAT / UNITE or the round changes, so the loss is never subtracted twice.
 * 联防 (UNITE): a leaker finally loses min(cap, the survivors of the 联防 battle that came from them); `uniteLeft` (its
 * enemies still standing, uniteRemaining — user playtest #6 item 7) replaces the own battle's count, so the loss falls
 * live as the helpers kill them, marked `unite` (联防中) with `left` = that uncapped number for the ×N tag. Without
 * `uniteLeft` (not a leaker, or no count yet) the own battle's count stays on show. The pending part goes when the
 * settlement lands. Boss rounds are not handled here (the merged team LP moves live through b.pool / m.public.teamLp).
 * @param {{ round: any, lp: number, statsLeaks: number|null } | null} base
 * @param {{ phase: string, round: any, lp: any, statsLeaks?: any, leaks?: any, cap?: number, alive?: boolean, uniteLeft?: number|null }} s
 * @returns {{ base: { round: any, lp: number, statsLeaks: number|null } | null, pending: number, shown: number|null, unite: boolean, left: number|null }}
 */
export function liveLp(base, { phase, round, lp, statsLeaks = null, leaks = 0, cap = 10, alive = true, uniteLeft = null }) {
  if (!Number.isFinite(lp)) return { base: null, pending: 0, shown: null, unite: false, left: null };
  if (!LEAK_PHASES.has(phase) || alive === false) return { base: null, pending: 0, shown: lp, unite: false, left: null };
  const sl = Number.isFinite(statsLeaks) ? statsLeaks : null;
  const b = base && base.round === round ? base : { round, lp, statsLeaks: sl };
  const landed = lp !== b.lp || (sl != null && b.statsLeaks != null && sl !== b.statsLeaks);
  const left = phase === PHASE.UNITE && Number.isFinite(uniteLeft) && uniteLeft >= 0 && !landed ? Math.trunc(uniteLeft) : null;
  const pending = landed ? 0 : Math.min(lp, pendingLoss(left != null ? left : leaks, cap));
  return { base: b, pending, shown: lp - pending, unite: phase === PHASE.UNITE && (pending > 0 || left != null), left };
}

/**
 * Tooltip of an LP tower with a pending loss (null without one).
 * @param {number} lp settled LP @param {number} pending @param {{ unite?: boolean, cap?: number }} [opts]
 */
export function pendingTip(lp, pending, { unite = false, cap = 10, left = null } = {}) {
  if (!(pending > 0)) return null;
  if (unite && Number.isFinite(left)) {
    const each = left > cap ? T('剩余不足 {0} 个后，队友每击倒一个少扣 1 点', cap) : T('队友每击倒一个就少扣 1 点');
    return T('目标生命值 {0}：联防中，你漏过的敌人还剩 {1} 个，{2}；按现在结算扣除 {3} 点（每回合至多 {4} 点）', lp, left, each, pending, cap);
  }
  return unite
    ? T('目标生命值 {0}：联防中，队友正在迎战你漏过的敌人，结算时按联防后剩余的敌人扣除（至多 {1} 点）', lp, pending)
    : T('目标生命值 {0}：本回合已有 {1}敌人进入蓝门，结算时扣除 {2} 点（每回合至多 {3} 点）', lp, pending >= cap ? T('{0} 个以上', cap) : T('{0} 个', pending), pending, cap);
}

// ---- temp overflow row (临时整备区, user playtest #3 item 3) ---------------------------------------------------

/**
 * Pieces waiting in the temp overflow row (m.private temp): how many, and how many are items.
 * @param {any} priv m.private
 * @returns {{ count: number, items: number }}
 */
export function tempInfo(priv) {
  const list = (Array.isArray(priv?.temp) ? priv.temp : []).filter((p) => p && typeof p === 'object');
  return { count: list.length, items: list.filter((p) => p.kind === 'item').length };
}

/** What the temp row asks of the player (the ready button's reason, the row's label). */
export const TEMP_RULE = T('放入整备区或战场、配发或使用后才能准备就绪；休整期结束时仍留在临时整备区的单位将被销毁');

/** Why 准备就绪 is refused while the temp row holds pieces (null when it is empty). */
export function tempReadyReason(priv) {
  const t = tempInfo(priv);
  return t.count ? T('临时整备区还有 {0} 个单位：{1}', t.count, TEMP_RULE) : null;
}

/**
 * Ready toggle (PREP only). Disabled while the temp row holds pieces — the reason shows under it (not only on hover):
 * "临时整备区 N 个单位待处理" (user playtest #3 item 3).
 * @param {{ priv:any, onToggle:(ready:boolean)=>void, busy?:boolean, readyCount?:number, total?:number }} props
 */
export function ReadyToggle({ priv, onToggle, busy, readyCount, total }) {
  const ready = !!priv?.ready;
  const temp = tempInfo(priv);
  const reason = !ready ? tempReadyReason(priv) || shopBlockReason('ready', { priv, editable: true }) : null;
  const btn = html`<button type="button" class=${cx('readybtn', 'tapx', ready && 'is-on', busy && 'is-busy')} disabled=${!!reason || busy}
      aria-pressed=${ready ? 'true' : 'false'} aria-describedby=${!ready && temp.count ? 'readywrap-why' : undefined} onClick=${() => onToggle(!ready)}>
    <span class="readybtn__box">${ready ? html`<${Icon} name="check" />` : null}</span>
    <span class="readybtn__label">${ready ? T('取消准备') : T('准备就绪') /* i18n-ok (next line): key name */}</span>
    <kbd class="readybtn__key">Space</kbd>
  </button>`;
  return html`<div class="readywrap">
    ${reason ? html`<${Tooltip} text=${reason} placement="bottom">${btn}<//>` : btn}
    ${!ready && temp.count ? html`<span class="readywrap__why" id="readywrap-why" role="status" data-testid="ready-why">
      <${Icon} name="warn" /><span>${T('临时整备区')} <b class="num">${temp.count}</b> ${T('个单位待处理')}</span></span>` : null}
    ${Number.isFinite(total) && total > 1 ? html`<span class="readywrap__count">${T('已就绪')} <b class="num">${readyCount}</b>/<span class="num">${total}</span></span>` : null}
  </div>`;
}

/**
 * Sprite + look of the two 🔍 HUD buttons for a state (pure; tested in test/ui/uiFixes.test.js).
 * @param {{ pen: boolean, penAvail: boolean, infoOpen: boolean }} st
 * @returns {{ left: { sprite: string, back: boolean, label: string, tip: string }, right: { sprite: string, grey: boolean, label: string, tip: string } }}
 */
export function checkButtons({ pen, penAvail, infoOpen }) {
  const left = pen
    ? { sprite: 'btn_check_player_back', back: true, label: T('返回'), tip: T('返回战场') }
    : { sprite: infoOpen ? 'btn_check_player_unfold' : 'btn_check_player_normal', back: false, label: T('本局信息'), tip: T('本局信息（策略 / 禁用盟约 / 干员）') };
  const right = pen
    ? { sprite: 'btn_check_enemy_unfold', grey: true, label: T('返回'), tip: T('返回') }
    : penAvail
      ? { sprite: 'btn_check_enemy', grey: false, label: T('敌方情报'), tip: T('查看即将迎击的敌方单位') }
      : { sprite: 'btn_check_enemy_unfold', grey: true, label: T('敌方情报'), tip: T('休整期可以查看即将迎击的敌方单位') };
  return { left, right };
}

/** One official 🔍 button: the sprite when installed, a CSS look-alike (icon + chevrons) otherwise. */
function CheckBtn({ sprite, cls, label, chev, on, disabled, onClick, testid }) {
  const url = localAsset('ui/battle', sprite);
  return html`<button type="button" class=${cx(cls, 'tapx', url && 'has-sprite', chev && 'is-wide', on && 'is-on')}
      style=${url ? `--chk-sprite:url("${url}")` : ''} aria-label=${label} aria-disabled=${disabled ? 'true' : 'false'}
      data-sprite=${sprite} data-testid=${testid} onClick=${onClick}>
    ${url ? null : html`<${Icon} name="search" />${chev ? html`<span class="enemybtn__chev">${chev}</span>` : null}`}
  </button>`;
}

/**
 * The red overtime (DOT) warning of a boss round (pure view of ui/matchStatus.js overtimeState).
 * @param {{ ot: ReturnType<typeof overtimeState> }} props
 */
export function OvertimeWarning({ ot }) {
  if (!ot) return null;
  if (ot.state === 'pending') {
    return html`<div class="otwarn otwarn--pending" role="alert" data-state="pending">
      <${LocalSprite} name="icon_warn" class="otwarn__icon" fallback=${html`<${Icon} name="warn" class="otwarn__icon" />`} />
      <span class="otwarn__tag">DOT</span>
      <span class="otwarn__txt">${TH('{0} 秒后全队生命值开始流失', html`<b class="num">${ot.secs}</b>`)}</span>
    </div>`;
  }
  return html`<div class="otwarn otwarn--drain" role="alert" data-state="drain">
    <span class="otwarn__blood">
      <${LocalSprite} name="blood_icon" class="otwarn__icon" fallback=${html`<${Icon} name="rook" class="otwarn__icon" />`} />
    </span>
    <span class="otwarn__tag">DOT</span>
    <span class="otwarn__txt">${T('超时 · 生命值')} <b class="num">−${ot.perSec}</b>${T('/秒')}</span>
    ${ot.lost > 0 ? html`<span class="otwarn__lost">${T('已流失')} <b class="num">${ot.lost}</b></span>` : null}
    <span key=${ot.secs} class="otwarn__tick num" aria-hidden="true">−${ot.perSec}</span>
  </div>`;
}

/** Two-bar pause glyph (the official battle pause button). */
function PauseGlyph() {
  return html`<svg class="pausebtn__glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zm7.5 0H18v16h-4.5z" /></svg>`;
}

/**
 * Solo pause / resume control (g.pause): pressed while paused.
 * @param {{ paused: boolean, busy?: boolean, onToggle: () => void }} props
 */
export function PauseButton({ paused, busy = false, onToggle }) {
  const label = paused ? T('继续作战') : T('暂停');
  return html`<${Tooltip} text=${paused ? T('继续作战（Space）') : T('暂停作战（Space）')} placement="bottom">
    <button type="button" class=${cx('pausebtn', 'tapx', paused && 'is-on', busy && 'is-busy')} aria-pressed=${paused ? 'true' : 'false'}
        aria-label=${label} disabled=${busy} data-testid="pause" onClick=${() => onToggle?.()}>
      ${paused ? html`<${Icon} name="play" class="pausebtn__glyph" />` : html`<${PauseGlyph} />`}
    </button>
  <//>`;
}

/**
 * Top bar.
 * @param {{ pub:any, priv:any, conn:any, hud:any, total:number|null, drawer:string|null, onExit:Function, onDrawer:(tab:string)=>void,
 *   onReady:(r:boolean)=>void, readyBusy?:boolean, readyCount?:number, playerCount?:number,
 *   pen?:boolean, penAvail?:boolean, onPen?:(on:boolean)=>void, config?: any, frozenAt?: number|null,
 *   pause?: { show: boolean, paused: boolean, busy?: boolean, onToggle: () => void } | null,
 *   live?: { pending: number, unite: boolean, left?: number|null } | null }} props
 *   frozenAt: the server time every clock shows while the solo match is paused (null = live)
 *   live: the own battle's pending LP loss (liveLp): the tower shows lp − pending in red with a −N tick, 联防中 during 联防;
 *     `left` (a leaker in 联防): its enemies still standing — the capsule's ×N tag
 */
export function TopBar({ pub, priv, conn, hud, total, drawer, onExit, onDrawer, onReady, readyBusy, readyCount, playerCount, pen = false, penAvail = false, onPen = () => {},
  config = null, frozenAt = null, pause = null, live = null }) {
  const phase = pub?.phase;
  const boss = isBossPhase(phase);
  const lp = boss && Number.isFinite(pub?.teamLp) ? pub.teamLp : Number.isFinite(priv?.lp) ? priv.lp : null;
  // normal rounds: the leaks of the own battle so far (boss rounds: the team LP above already moves live)
  const pending = !boss && Number.isFinite(lp) && live && live.pending > 0 ? Math.min(lp, live.pending) : 0;
  const hidden = phase === PHASE.HIDDEN_CORE || (Number.isFinite(pub?.lastRound) && pub.round > pub.lastRound);
  const roundText = hidden ? '??' : pub?.round > 0 ? String(pub.round) : '--';
  const showReady = phase === PHASE.PREP && priv?.alive !== false;
  // boss rounds: the overtime warning follows the clock (4 Hz while live; frozen while paused)
  const otLive = boss && Number(pub?.overtimeAt) > 0;
  useTicker(otLive && frozenAt == null ? 250 : 0);
  const now = Number.isFinite(frozenAt) ? frozenAt : serverNow();
  const ot = otLive ? overtimeState(pub, now, { perSec: overtimeDrainPerSec(config) }) : null;
  const draining = ot?.state === 'drain';
  const lowLp = (Number.isFinite(lp) && lp - pending <= 5) || draining;
  const cap = Number(config?.lpCapPerRound) > 0 ? Number(config.lpCapPerRound) : 10;
  const frozenSecs = Number.isFinite(frozenAt) ? remainAt(pub?.deadline, frozenAt) : null;
  const btn = checkButtons({ pen, penAvail, infoOpen: !!drawer });
  const onLeft = () => (pen ? onPen(false) : onDrawer('info'));
  const onRight = () => (pen ? onPen(false) : penAvail ? onPen(true) : null);
  return html`<header class=${cx('gtop', pen && 'is-pen')}>
    <div class="gtop__left">
      <${Button} variant="danger" size="lg" square=${true} icon="exit" onClick=${onExit} aria-label=${T('离开')} title=${T('离开 / 暂离')} class="gtop__exit tapx" />
      <div class="gtop__meta">
        <${PingPill} ms=${conn?.ping} online=${conn?.status === 'online'} />
        ${pub?.difficulty ? html`<${DifficultyTag} difficulty=${pub.difficulty} size="sm" />` : null}
      </div>
    </div>

    <div class="gtop__center brackets">
      <${Tooltip} text=${btn.left.tip} placement="bottom">
        <${CheckBtn} sprite=${btn.left.sprite} cls=${cx('gtop__iconbtn', btn.left.back && 'is-back')} label=${btn.left.label}
          chev=${btn.left.back ? '◀◀' : null} on=${!!drawer && !pen} onClick=${onLeft} testid="check-player" />
      <//>
      <div class="roundbox">
        <span class="roundbox__label">${T('回合')}</span>
        <b class="roundbox__num num">${roundText}</b>
      </div>
      <${PhaseCapsule} pub=${pub} hud=${hud} miss=${!boss && Number.isFinite(live?.left) ? live.left : null} />
      <${LpTower} value=${lp} size="lg" tone=${lowLp ? 'danger' : boss ? 'team' : null} pending=${pending}
        note=${pending > 0 && live?.unite ? T('联防中') : null} tip=${pendingTip(lp, pending, { unite: !!live?.unite, cap, left: live?.left ?? null })} />
      <${Tooltip} text=${btn.right.tip} placement="bottom">
        <${CheckBtn} sprite=${btn.right.sprite} cls=${cx('enemybtn', btn.right.grey && 'is-grey')} label=${btn.right.label}
          chev=${btn.right.grey ? null : '▶▶'} disabled=${btn.right.grey && !pen} onClick=${onRight} testid="check-enemy" />
      <//>
    </div>

    <div class="gtop__right">
      <div class="gtop__clock">
        ${frozenSecs != null
          ? html`<${Countdown} seconds=${frozenSecs} total=${total ?? undefined} size="md" label="PAUSED" />`
          : html`<${Countdown} deadline=${pub?.deadline} total=${total ?? undefined} size="md" />`}
        ${pause && (pause.show || pause.paused) ? html`<${PauseButton} paused=${!!pause.paused} busy=${pause.busy} onToggle=${pause.onToggle} />` : null}
      </div>
      <${OvertimeWarning} ot=${ot} />
      ${showReady ? html`<${ReadyToggle} priv=${priv} onToggle=${onReady} busy=${readyBusy} readyCount=${readyCount} total=${playerCount} />` : null}
    </div>
  </header>`;
}

/** DP counter shown at the right edge during combat. */
export function DpCounter({ dp }) {
  if (!Number.isFinite(dp)) return null;
  return html`<div class="dpbox" title=${T('部署费用（再部署消耗）')}>
    <${GIcon} name="dp" class="dpbox__icon" /><b class="num">${Math.floor(dp)}</b><${MicroLabel}>COST</${MicroLabel}>
  </div>`;
}

/** Hook: stable callback ref helper. */
export function useLatest(v) {
  const r = useRef(v);
  r.current = v;
  return r;
}
