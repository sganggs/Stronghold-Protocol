// Left team panel (research 06 §11.1, research 09 §3.1): one row per seat — avatar (band icon once picked), name, LP
// tower, status glyph (… acting / ✓ ready / ⌛ deciding / ⚔ combat / door left / ✕ dead), AI badge, "you" marker, the
// field being watched (eye badge), and emote bubbles.
// Observing (client-side combat, `observe` prop — the official flow): tapping a teammate's avatar expands a mint
// "前往查看" button under the row (when that teammate can be observed now; otherwise the reason is toasted through
// onWatch); while observing, the own row shows a "返回战场" button. Without `observe` (server-run combat) a click
// watches that player's field at once.
// Live LP (user playtest #3 item 2): during a normal round's battle each row's tower shows lp − the loss that player's
// leaks so far will cost (red, −N): the own row the top bar's live value (`self`, ui/hud.js liveLp), a teammate's row
// m.public players[].pendingLp (server/match/Match.js, ~1 Hz). 联防 (user playtest #6 item 7): a leaker's row adds the
// runner tag ×N — its enemies still standing on the 联防 field, uncapped and live (falling as the helpers kill them,
// rising when one splits) — next to lp − min(lpCapPerRound, N): the own row the top bar's value, a teammate's row the
// local 联防 replica's count while it is on screen (`uniteLocal`: the battle runner's state().uniteLeft, the same battle
// the player watches, so the number moves with the kills on screen), else m.public players[].uniteLeft (the authority's
// report, ~1 Hz).

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { html, Icon, Tooltip } from './components.js';
import { PlayerAvatar, LpTower, GIcon, LocalSprite } from './gameComponents.js';
import { EmoteBubble } from './emotes.js';
import { STATUS_META, sortedPlayers } from './gameLogic.js';
import { MissTag, uniteRemaining } from './hud.js';
import { localAsset } from '../data.js';
import { T } from '../i18n.js';
const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Official status glyphs (ui/battle) per m.public players[].status; CSS glyph fallback. */
const STATUS_SPRITE = { ready: 'icon_ready', deciding: 'icon_waiting', done: 'icon_complete', dead: 'icon_dead' };

/**
 * A row's LP tower: the settled LP and the pending loss of the round's battle (0 outside COMBAT / UNITE). The own row
 * takes the top bar's live value when there is one (its m.private lp: the same number as the top bar). `left`: during
 * 联防 a leaker's enemies still standing (the ×N tag), else null — for a teammate the local 联防 replica's count when
 * one is given (`uniteLocal`, the runner's state().uniteLeft: { [playerId]: n }, absent = none left; the pending loss
 * is then min(cap, left)), else m.public players[].uniteLeft / pendingLp.
 * @param {any} p m.public players[] entry @param {any} pub m.public
 * @param {{ lp?: number|null, pending: number, unite: boolean, left?: number|null } | null} [self] the own live value (only for the own row)
 * @param {{ uniteLocal?: Record<string, number> | null, cap?: number }} [opts]
 * @returns {{ lp: number|null, pending: number, unite: boolean, left: number|null }}
 */
export function rowLp(p, pub, self = null, { uniteLocal = null, cap = 10 } = {}) {
  const pubLp = Number.isFinite(p?.lp) ? p.lp : null;
  if ((pub?.phase !== PHASE.COMBAT && pub?.phase !== PHASE.UNITE) || p?.alive === false) return { lp: pubLp, pending: 0, unite: false, left: null };
  const lp = self && Number.isFinite(self.lp) ? self.lp : pubLp;
  const leaker = pub.phase === PHASE.UNITE && Array.isArray(pub.unite?.leakers) && pub.unite.leakers.includes(p.playerId);
  const local = !self && leaker && uniteLocal && typeof uniteLocal === 'object' ? uniteRemaining(uniteLocal[p.playerId] ?? 0, null) : null;
  const rawLeft = pub.phase !== PHASE.UNITE ? null : self ? self.left : local != null ? local : p.uniteLeft;
  const left = Number.isFinite(rawLeft) && rawLeft >= 0 ? Math.trunc(rawLeft) : null;
  if (lp == null) return { lp, pending: 0, unite: false, left };
  const raw = self ? self.pending : local != null ? Math.min(cap, local) : p.pendingLp;
  const pending = Math.min(lp, Math.max(0, Math.trunc(Number(raw) || 0)));
  return { lp, pending, unite: (pending > 0 || left != null) && (self ? !!self.unite : pub.phase === PHASE.UNITE), left };
}

/**
 * Tooltip of a row's LP tower with a pending loss (null without one).
 * @param {{ lp: number|null, pending: number, unite: boolean, left: number|null } | null} lp rowLp(...)
 * @param {number} [cap] lpCapPerRound
 */
export function rowLpTip(lp, cap = 10) {
  if (!lp || !(lp.pending > 0)) return null;
  if (lp.unite && lp.left != null) return T('目标生命值 {0}，联防中：漏过的敌人还剩 {1} 个，按现在结算扣除 {2} 点（每回合至多 {3} 点）', lp.lp, lp.left, lp.pending, cap);
  return T('目标生命值 {0}，{1}结算时扣除{2} {3} 点', lp.lp, lp.unite ? T('联防中，') : '', lp.unite ? T('至多') : '', lp.pending);
}

/**
 * @param {{ pub:any, myId:string, watching:string|null, bubbles: Map<string,{id:string,seq:number}>, onWatch:(p:any)=>void,
 *   compact?: boolean, teamLp?: number|null, self?: { lp?: number|null, pending: number, unite: boolean, left?: number|null } | null,
 *   cap?: number, uniteLocal?: Record<string, number> | null,
 *   observe?: null | { canObserve: (p:any) => { fieldId?: string, reason?: string|null, back?: boolean }, observing: boolean, onBack: () => void } }} props
 *   uniteLocal: the local 联防 replica's per-leaker counts while it is on screen (battle runner state().uniteLeft), else null
 */
export function TeamPanel({ pub, myId, watching, bubbles, onWatch, compact = false, observe = null, self: selfLive = null, cap = 10, uniteLocal = null }) {
  const [openPid, setOpenPid] = useState(null);
  const phaseKey = `${pub?.phase}:${pub?.round}`;
  useEffect(() => { setOpenPid(null); }, [phaseKey, watching, observe?.observing]);
  const players = sortedPlayers(pub);
  if (!players.length) return null;
  const click = (p, self) => {
    if (!observe) { onWatch(p); return; }
    if (self) { if (observe.observing) observe.onBack(); setOpenPid(null); return; }
    const t = observe.canObserve(p) || {};
    if (!t.fieldId) { setOpenPid(null); onWatch(p); return; } // the game screen toasts the reason
    setOpenPid((cur) => (cur === p.playerId ? null : p.playerId));
  };
  return html`<aside class=${cx('team', compact && 'team--compact')} aria-label=${T('同盟成员')}>
    ${players.map((p) => {
      const self = p.playerId === myId;
      const status = p.alive === false ? 'dead' : p.status;
      const meta = STATUS_META[status] || STATUS_META.acting;
      const watched = watching && (watching === p.fieldId || watching === `n:${p.playerId}`);
      const bubble = bubbles?.get(p.playerId);
      const offline = p.connected === false && !p.isBot;
      const open = !!observe && openPid === p.playerId && !self;
      const back = !!observe && self && observe.observing;
      const title = observe ? (self ? (observe.observing ? T('返回战场') : T('你自己')) : T('查看 {0} 的战场', p.name)) : (self ? T('查看自己的阵地') : T('查看 {0} 的阵地', p.name));
      const lp = rowLp(p, pub, self ? selfLive : null, { uniteLocal, cap });
      return html`<div key=${p.playerId} class=${cx('team__row', self && 'is-self', watched && 'is-watched', p.alive === false && 'is-dead', open && 'is-open')}>
        <button type="button" class="team__btn" onClick=${() => click(p, self)} title=${title} aria-expanded=${observe && !self ? String(open) : undefined}>
          <${PlayerAvatar} player=${p} self=${self} />
          <span class="team__seat num">P${(p.seat ?? 0) + 1}</span>
          ${p.isBot ? html`<span class="team__ai">AI</span>` : null}
          ${self ? html`<span class="team__you"><${Icon} name="user" /></span>` : null}
        </button>
        <div class="team__info">
          <span class="team__name">${p.name || T('博士')}</span>
          <div class="team__line">
            <${LpTower} value=${lp.lp} size="sm" tone=${Number.isFinite(lp.lp) && lp.lp - lp.pending <= 5 ? 'danger' : null} pending=${lp.pending}
              tip=${rowLpTip(lp, cap)} />
            ${lp.left != null ? html`<${MissTag} n=${lp.left} name=${self ? null : p.name || T('博士')} />` : null}
            <${Tooltip} text=${offline ? T('连接已断开') : meta.text} placement="right">
              <span class=${cx('team__status', `is-${meta.tone}`, offline && 'is-offline', (offline || STATUS_SPRITE[status]) && localAsset('ui/battle', offline ? 'icon_lost_connect' : STATUS_SPRITE[status]) && 'has-sprite')} aria-label=${meta.text}>
                ${offline ? html`<${LocalSprite} name="icon_lost_connect" fallback=${html`<${Icon} name="wifiOff" />`} />`
                  : STATUS_SPRITE[status] ? html`<${LocalSprite} name=${STATUS_SPRITE[status]} fallback=${html`<${GIcon} name=${meta.glyph} />`} />`
                  : html`<${GIcon} name=${meta.glyph} />`}
              </span>
            <//>
            ${watched && !self ? html`<span class="team__eye" title=${T('正在查看')}><${GIcon} name="eye" /></span>` : null}
          </div>
          ${open ? html`<button type="button" class="btn btn--primary btn--sm team__ob"
            onClick=${() => { setOpenPid(null); onWatch(p); }}><span class="btn__label">${T('前往查看')}</span></button>` : null}
          ${back ? html`<button type="button" class="btn btn--secondary btn--sm team__back"
            onClick=${() => observe.onBack()}><span class="btn__label">${T('返回战场')}</span></button>` : null}
        </div>
        ${bubble ? html`<${EmoteBubble} key=${bubble.seq} id=${bubble.id} class="team__bubble" />` : null}
      </div>`;
    })}
  </aside>`;
}
