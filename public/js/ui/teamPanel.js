// Left team panel (research 06 §11.1, research 09 §3.1): one row per seat — avatar (band icon once picked), name, LP
// tower, status glyph (… acting / ✓ ready / ⌛ deciding / ⚔ combat / door left / ✕ dead), AI badge, "you" marker, the
// field being watched (eye badge), and emote bubbles. In a boss round the viewer's pair is framed in green from the
// round's start (gameLogic teamFrameIds; community report of 2026-10-06, item 51).
// Observing (client-side combat, `observe` prop — the official flow): tapping a teammate's avatar expands a mint
// "前往查看" button under the row (when that teammate can be observed now; otherwise the reason is toasted through
// onWatch); while observing, the own row shows a "返回战场" button. Without `observe` (server-run combat) a click
// watches that player's field at once, and a click while that field is already on screen does not ask again.
// In PHASE.PREP a double-click on a teammate's avatar opens their field (GitHub #131, the 「前往查看」 shortcut).
// It does not open a field the teammate does not have, and it does not open one the click already opened.
// Boss-prep phases (最终攻势 / 隐秘核心) are not PHASE.PREP, so they still use 「前往查看」.
// Live LP (user playtest #3 item 2): during a normal round's battle each row's tower shows lp − the loss that player's
// leaks so far will cost (red, −N): the own row the top bar's live value (`self`, ui/hud.js liveLp), a teammate's row
// m.public players[].pendingLp (server/match/match/views.js, ~1 Hz). 联防 (user playtest #6 item 7): a leaker's row adds the
// runner tag ×N — its enemies still standing on the 联防 field, uncapped and live (falling as the helpers kill them,
// rising when one splits) — next to lp − min(lpCapPerRound, N): the own row the top bar's value, a teammate's row the
// local 联防 replica's count while it is on screen (`uniteLocal`: the battle runner's state().uniteLeft, the same battle
// the player watches, so the number moves with the kills on screen), else m.public players[].uniteLeft (the authority's
// report, ~1 Hz).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { html, Icon, Tooltip, BondDisc } from './components.js';
import { PlayerAvatar, LpTower, GIcon, LocalSprite, UnitThumb, BandIcon, RichText } from './gameComponents.js';
import { EmoteBubble } from './emotes.js';
import { STATUS_META, sortedPlayers, teamFrameIds, sortBonds, nextThreshold } from './gameLogic.js';
import { MissTag, uniteRemaining } from './hud.js';
import { localAsset, data } from '../data.js';
import { bondIconUrl } from './assetUrls.js';
import { t } from '../../../shared/i18n.js';

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

/** True when `watching` is already this teammate's field (their live field, or the prep scout `n:<id>`). */
export function teammateFieldShown(watching, player) {
  if (!watching || !player) return false;
  return watching === player.fieldId || watching === `n:${player.playerId}`;
}

/**
 * A single click on a teammate avatar calls onWatch only in server-run combat (no `observe`), and only when
 * that field is not already on screen. A double-click fires click first; the second click, and any later click
 * while the view is already theirs, must not open it again. Client combat never watches from the avatar click.
 * `askedRecently`: this avatar's click already called onWatch in the last moment (the other click of a double-click,
 * before `watching` has re-rendered).
 * @param {{ observe?: unknown, watching?: string|null, player?: { playerId?: string, fieldId?: string }|null, askedRecently?: boolean }} [o]
 * @returns {boolean}
 */
export function teammateClickWatches(o = {}) {
  if (o.observe || o.askedRecently) return false;
  if (teammateFieldShown(o.watching, o.player)) return false;
  return !!o.player;
}

/**
 * Double-click in PHASE.PREP opens a teammate's field, skipping 「前往查看」. False — do not call onWatch — when
 * the phase is not PREP, the row is your own, there is no client-combat `observe` (the click already watched),
 * `canObserve` has no field (do not force a view; the click toasts), or that field is already open.
 * @param {{ phase?: string, self?: boolean, observe?: { canObserve?: (p: any) => { fieldId?: string }|null }|null,
 *   watching?: string|null, player?: any, askedRecently?: boolean }} [o]
 * @returns {boolean}
 */
export function prepDblClickWatches(o = {}) {
  if (o.phase !== PHASE.PREP || o.self || !o.player || !o.observe) return false;
  if (o.askedRecently || teammateFieldShown(o.watching, o.player)) return false;
  const view = (typeof o.observe.canObserve === 'function' ? o.observe.canObserve(o.player) : null) || {};
  return !!view.fieldId;
}

/** How long the second click of a double-click counts as "already asked" before `watching` re-renders. */
const AVATAR_CLICK_GAP_MS = 500;

/**
 * Tooltip of a row's LP tower with a pending loss (null without one).
 * @param {{ lp: number|null, pending: number, unite: boolean, left: number|null } | null} lp rowLp(...)
 * @param {number} [cap] lpCapPerRound
 */
export function rowLpTip(lp, cap = 10) {
  if (!lp || !(lp.pending > 0)) return null;
  if (lp.unite && lp.left != null) return t('目标生命值 {lp}，联防中：漏过的敌人还剩 {left} 个，按现在结算扣除 {pending} 点（每回合至多 {cap} 点）', { lp: lp.lp, left: lp.left, pending: lp.pending, cap });
  return lp.unite ? t('目标生命值 {lp}，联防中，结算时扣除至多 {pending} 点', { lp: lp.lp, pending: lp.pending })
    : t('目标生命值 {lp}，结算时扣除 {pending} 点', { lp: lp.lp, pending: lp.pending });
}

// ---- 「同盟盟约速查」浮窗 ----------------------------------------------------------------
//
// 队伍栏右缘的一列紧凑浮窗：每个座位一行，显示该座位已激活的盟约（仅图标，排序同顶栏）、其场上干员与本局策略。
// 它不复用顶栏的 BondStrip：那个组件会画名字和槽位数，空态文案也是给横条用的，都不适合这里的一行。
//
// 数据按观众裁剪（PR #922 批注）：m.public 不携带 boardOps（它是一条广播，会绕过 g.watch）；自己的干员来自
// m.private.boardOps，队友的来自 g.peek → m.peek（server/match/match/peek.js，状态通道：只读名册流、常开、
// 除自己外所有座位），或来自屏上的侦察 / 战场视图（game.js flyOpsFor，屏上优先）。场上没有干员的座位
// （已淘汰、已离场）仍显示盟约（本就是公开的），干员列为空。
// 侧边栏展开的干员只需要上场的干员和干员是否精英化的情况，优化逻辑为独立消息通道，不越界传输g.watch的详细战场信息

/** charId → display name, from the same chess records the thumbnails use (a composed record has no name of its own). */
let charNames = null;
let charNamesSrc = null;
function charName(id) {
  const chess = data.get('chess');
  if (chess !== charNamesSrc) {
    charNamesSrc = chess;
    charNames = new Map();
    for (const rec of Object.values(chess || {})) {
      if (rec?.charId && rec.name && !charNames.has(rec.charId)) charNames.set(rec.charId, rec.name);
    }
  }
  return charNames.get(id) || null;
}

/**
 * Build a chess-shaped record for the thumbnail when `boardOps` sends a char id (not a chess id, which UnitThumb
 * already knows how to look up). Exported for the UI tests.
 */
export function flyOpRec(u, lookup = (id) => data.lookup('chess', id), nameOf = charName) {
  if (!u?.id || lookup(u.id)) return null;
  return { charId: u.id, name: nameOf(u.id) || u.id, assets: { avatar: u.id }, isGolden: !!u.golden };
}

/**
 * The chess id of a flyout operator, for the operator card (`resolveDetail` reads chess records, not char ids).
 * `boardOps` sends a char id (server/match/match/views.js `_boardOps`), a chess id when the seat's field record is
 * missing. A golden operator resolves to its golden chess record when there is one. Exported for the UI tests.
 */
export function flyOpChessId(u, lookup = (id) => data.lookup('chess', id), chess = () => data.get('chess')) {
  if (!u?.id) return null;
  if (lookup(u.id)) return u.id;
  let plain = null;
  for (const [cid, rec] of Object.entries(chess() || {})) {
    if (rec?.charId !== u.id) continue;
    if (u.golden ? rec.isGolden : !rec.isGolden) return cid;
    if (!plain) plain = cid;
  }
  return plain;
}

/**
 * Per-viewer on-field operators for the flyout (PR #922 review). The own seat reads m.private.boardOps; a teammate
 * only when their field is the one on screen (a prep scout, or a battle the viewer may watch — g.watch already
 * refused every other field), and always board-only, chess-only. The result is `{ [playerId]: [{ id, golden? }] }`.
 * A prep scout (`prep: true`, fieldId `n:<pid>`) carries its board in the meta itself: no battle runs yet, so the
 * runner has nothing for it (client-combat matches still have `cc` true in prep — reading the runner there would empty
 * the row while that board is plainly on screen). A battle reads the runner's board in client combat, else the meta's.
 * Exported for the tests.
 */
export function flyOpsFor({ myId, priv = null, field = null, players = null, cc = false, runner = null }) {
  const out = {};
  const own = priv?.boardOps;
  if (Array.isArray(own) && own.length) out[myId] = own;
  if (!field?.fieldId) return out;
  // the field's members: a normal field / prep board is `n:<pid>`; a shared (府/联防) field lists them in `players` or sides
  const onField = (pid) => {
    if (Array.isArray(field.players)) return field.players.includes(pid);
    if (field.fieldId === `n:${pid}`) return true;
    return !!field.sides && typeof field.sides === 'object' && Object.prototype.hasOwnProperty.call(field.sides, pid);
  };
  for (const p of Array.isArray(players) ? players : []) {
    const pid = p.playerId;
    if (!pid || pid === myId || p.alive === false || !onField(pid)) continue;
    const units = (!field.prep && cc && runner ? runner.ownerOps?.(pid, field.fieldId) : field.units) || field.units || [];
    const ops = [];
    for (const u of units) {
      if (!u || u.kind !== 'op' || (u.ownerId && u.ownerId !== pid)) continue;
      if (u.area && u.area !== 'board') continue;
      const id = u.avatar || u.diy?.charId || u.defId || u.id;
      if (id) ops.push({ id, ...(u.golden ? { golden: 1 } : {}) });
    }
    if (ops.length) out[pid] = ops;
  }
  return out;
}

/**
 * 浮窗的干员总表：屏上能显示的座位（game.js flyOpsFor）优先，其余——战场不在屏上的队友——取自 peek
 * （m.peek，server/match/match/peek.js）。空列表不覆盖非空列表（`m.peek` 在座位淘汰时发 `[]`：
 * 此时屏上本来也没有该行）。
 * 导出供 UI 测试使用。
 */
export function mergeFlyOps(base, peek) {
  const out = {};
  for (const [pid, list] of Object.entries(peek || {})) if (Array.isArray(list) && list.length) out[pid] = list;
  for (const [pid, list] of Object.entries(base || {})) if (Array.isArray(list) && list.length) out[pid] = list;
  return out;
}

/** The seat's bonds, icon only — no names, no empty-state copy (the reviewer's point against reusing BondStrip).
 * `layersDisabled` (联防 / boss: layers no longer stack) freezes the pips as the top strip does. The mode-off bonds
 * (`off`, the strip's grey 本局禁用 discs) stay out: a mode can disable half the core bonds, which would double a
 * row this narrow. */
function FlyBonds({ bonds, ownerId, onBond = null, layersDisabled = false }) {
  const m = data.get('assets');
  const list = sortBonds(Array.isArray(bonds) ? bonds : []).filter((b) => !b.off);
  return list.map((b) => {
    const rec = data.lookup('bonds', b.bondId);
    const th = Array.isArray(b.thresholds) && b.thresholds.length ? b.thresholds : rec?.thresholds || [];
    const next = nextThreshold(b.count ?? 0, th);
    const name = rec?.name || b.bondId;
    const title = `${name} ${b.count ?? 0}/${next ?? th[th.length - 1] ?? '-'}${b.harmony > 0 ? t('（含调和 +{harmony}）', { harmony: b.harmony }) : ''}`;
    return html`<${BondDisc} key=${b.bondId} name=${name} icon=${bondIconUrl(m, b.bondId)}
      layers=${rec?.noStack ? undefined : b.layers ?? 0} tier=${b.tier ?? 0} maxTier=${Math.max(1, th.length)}
      active=${!!b.active} size="sm" showName=${false} layersDisabled=${layersDisabled} title=${title}
      onClick=${onBond ? () => onBond(b.bondId, ownerId) : undefined} />`;
  });
}

/**
 * The operators a seat has on its field; the cell around this list is the sideways scroller. A click opens that
 * operator's card (`onOp`), the same TeamDetailPanel a bench / hand operator opens.
 */
function FlyOps({ ops, onOp = null }) {
  const list = Array.isArray(ops) ? ops : [];
  const thumb = (u) => html`<${UnitThumb} kind="chess" id=${u.id} rec=${flyOpRec(u)} size="xs" golden=${!!u.golden} class="team__fly-op" />`;
  return list.map((u, i) => {
    if (!onOp) return html`<${UnitThumb} key=${`${u.id}:${i}`} kind="chess" id=${u.id} rec=${flyOpRec(u)} size="xs"
      golden=${!!u.golden} class="team__fly-op" />`;
    const name = data.lookup('chess', u.id)?.name || charName(u.id) || u.id;
    return html`<button type="button" key=${`${u.id}:${i}`} class="team__fly-opbtn" title=${name} aria-label=${name}
      onClick=${() => onOp(u)}>${thumb(u)}</button>`;
  });
}

/**
 * The strategy a seat picked in the opening draft, in the same grid row (sticky to the right while scrolling). With a
 * band it is a button: the click opens `BandPopup` beside the square, the same name / effect / description the 本局信息
 * drawer shows (that tab is closed while the flyout is open, so the flyout needs its own way in).
 */
function FlyBand({ bandId, owner = null, onOpen = null }) {
  const b = typeof bandId === 'string' && bandId ? data.lookup('bands', bandId) : null;
  if (!b) return html`<div class="team__fly-band" role="group" aria-label=${t('策略')}></div>`;
  return html`<button type="button" class="team__fly-band is-clickable" aria-label=${t('策略')} title=${b.name || ''}
    onClick=${(e) => onOpen?.(bandId, owner, e.currentTarget)}><${BandIcon} bandId=${bandId} /></button>`;
}

/** Band details anchored to the right of the flyout (fixed, so the per-cell scrollers cannot clip it). */
function BandPopup({ band, onClose }) {
  const b = data.lookup('bands', band.bandId);
  if (!b) return null;
  return html`<div class="team__fly-bandpop" role="dialog" aria-label=${t('策略')}
      style=${`right:${band.right}px;top:${band.top}px`}>
    <header class="team__fly-bandpop__head">
      <${BandIcon} bandId=${b.bandId} size="md" />
      <div class="team__fly-bandpop__titles">
        <small class="team__fly-bandpop__kicker">STRATEGY // ${band.owner ? t('{bandOwner} 的策略', { bandOwner: band.owner }) : t('我的策略')}</small>
        <b>${b.name}${b.effectName ? html` <small>${b.effectName}</small>` : null}</b>
      </div>
      <button type="button" class="team__fly-bandpop__close tapx" aria-label=${t('关闭')} onClick=${onClose}>
        <${Icon} name="close" /></button>
    </header>
    <${RichText} as="p" text=${b.descRaw || b.desc} class="team__fly-bandpop__desc" />
  </div>`;
}

function BondsToggle({ open, onToggle }) {
  const label = open ? t('收起同盟盟约速查') : t('展开同盟盟约速查');
  return html`<button type="button" class=${cx('team__bonds-toggle', open && 'is-open')}
    aria-expanded=${String(open)} aria-controls="team-bonds" title=${label} aria-label=${label}
    onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }}
    onClick=${onToggle}><${Icon} name=${open ? 'chevronLeft' : 'chevronRight'} /></button>`;
}

/**
 * 「同盟盟约速查」: the toggle bar and the window. A row is a three-column grid — bonds 1fr, on-field operators 1fr,
 * the strategy square — so both halves take the same width and the strategy always shares its row. Rows mirror the
 * roster heights (`rowH`, measured by TeamPanel), so expanding a 「前往查看」 row does not shift the rest. Every cell
 * pans sideways on its own (mouse drag or native touch pan); each close/reopen starts at the leftmost bond again.
 */
function BondsFlyout({ players, myId, open, onToggle, onBond = null, flyOps = null, onOp = null, rowH = null, layersDisabled = false }) {
  const rows = useRef(null);
  const drag = useRef(null);
  const dragged = useRef(false);
  const [bandPop, setBandPop] = useState(null);
  useEffect(() => { if (!open) setBandPop(null); }, [open]);
  // a click anywhere but the card / the square itself dismisses the band card (pointerdown, like the flyout's own)
  useEffect(() => {
    if (!bandPop) return undefined;
    const away = (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.team__fly-bandpop') || e.target.closest('.team__fly-band')) return;
      setBandPop(null);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [bandPop]);
  useEffect(() => {
    if (!open || !rows.current) return;
    for (const cell of rows.current.querySelectorAll('.team__fly-cell')) cell.scrollLeft = 0;
  }, [open]);
  const openBand = (bandId, owner, el) => {
    const r = el.getBoundingClientRect();
    const vw = globalThis.innerWidth || document.documentElement.clientWidth || 1920;
    const vh = globalThis.innerHeight || document.documentElement.clientHeight || 1080;
    setBandPop({
      bandId,
      owner: owner || null,
      right: Math.max(8, Math.round(vw - r.left + 8)),
      top: Math.max(8, Math.min(Math.round(r.top), Math.round(vh - 240))),
    });
  };
  const cellAt = (e) => (e.target instanceof Element ? e.target.closest('.team__fly-cell') : null);
  const down = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const cell = cellAt(e);
    if (!cell || cell.scrollWidth <= cell.clientWidth + 1) return; // nothing to pan: leave the disc's click alone
    drag.current = { id: e.pointerId, x: e.clientX, left: cell.scrollLeft, cell, moved: false };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      dragged.current = true;
      d.cell.classList.add('is-dragging');
      // capture only once this is really a drag: capturing on pointerdown retargets the click and the disc never fires
      try { d.cell.setPointerCapture(e.pointerId); } catch { /* not captured */ }
    }
    if (d.moved) d.cell.scrollLeft = d.left - dx;
  };
  const up = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    d.cell.classList.remove('is-dragging');
    if (d.moved) { try { d.cell.releasePointerCapture(e.pointerId); } catch { /* already released */ } }
  };
  const clickCapture = (e) => {
    if (!dragged.current) return;
    dragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const cell = (cls, empty, children) => html`<div class=${cx('team__fly-cell', cls, empty && 'is-empty')}>
    <div class="team__fly-track">${empty ? null : children}</div>
  </div>`;
  const row = (p) => {
    const h = rowH?.[p.playerId];
    const dead = p.alive === false;
    return html`<div key=${p.playerId} class=${cx('team__fly-row', p.playerId === myId && 'is-self')}
        style=${h ? `--fly-row-h:${h}px` : undefined}>
      ${cell('team__fly-bonds', dead, html`<${FlyBonds} bonds=${p.bonds} ownerId=${p.playerId} onBond=${onBond} layersDisabled=${layersDisabled} />`)}
      ${cell('team__fly-ops', dead, html`<${FlyOps} ops=${flyOps?.[p.playerId]} onOp=${onOp ? (u) => onOp(u, p) : null} />`)}
      <${FlyBand} bandId=${dead ? null : p.bandId} owner=${p.playerId === myId ? null : p.name} onOpen=${openBand} />
    </div>`;
  };
  return html`<div class=${cx('team__fly', open && 'is-open')}>
    <${BondsToggle} open=${open} onToggle=${onToggle} />
    ${open ? html`<div class="team__fly-window" id="team-bonds" role="region" aria-label=${t('同盟盟约速查')}>
      <div class="team__fly-rows" ref=${rows} onPointerDown=${down} onPointerMove=${move}
        onPointerUp=${up} onPointerCancel=${up} onClickCapture=${clickCapture}>${players.map(row)}</div>
    </div>` : null}
    ${bandPop ? html`<${BandPopup} band=${bandPop} onClose=${() => setBandPop(null)} />` : null}
  </div>`;
}

/**
 * @param {{ pub:any, myId:string, watching:string|null, bubbles: Map<string,{id:string,seq:number}>, onWatch:(p:any)=>void,
 *   compact?: boolean, teamLp?: number|null, self?: { lp?: number|null, pending: number, unite: boolean, left?: number|null } | null,
 *   cap?: number, uniteLocal?: Record<string, number> | null,
 *   flyOps?: Record<string, Array<{ id:string, golden?:number }>> | null, onBond?: ((bondId:string, ownerId:string)=>void) | null,
 *   observe?: null | { canObserve: (p:any) => { fieldId?: string, reason?: string|null, back?: boolean }, observing: boolean, onBack: () => void } }} props
 *   uniteLocal: the local 联防 replica's per-leaker counts while it is on screen (battle runner state().uniteLeft), else null
 *   flyOps: the per-viewer on-field operators (game.js flyOpsFor + mergeFlyOps); a seat missing here gets no operator column
 *   onBond: opens the bond detail popup for that seat (game.js openBond)
 *   onOp: opens a flyout operator's card, called `(u, player)` (game.js setDetail, the bench operator's panel)
 *   layersDisabled: 联防 / boss — layers no longer stack, so the flyout discs freeze their pips like the top strip
 *   onFlyToggle: 浮窗展开 / 收起（game.js actions.peek → g.peek），服务端据此订阅 / 解除
 *   online: 连接是否在线 —— false → true 的边沿会收起浮窗（服务端此时已丢弃订阅）
 */
export function TeamPanel({ pub, myId, watching, bubbles, onWatch, compact = false, observe = null, self: selfLive = null, cap = 10, uniteLocal = null, spMarks = null, flyOps = null, onBond = null, onOp = null, layersDisabled = false, onFlyToggle = null, online = null }) {
  const [openPid, setOpenPid] = useState(null);
  const [bondsOpen, setBondsOpen] = useState(false);
  const [rowH, setRowH] = useState({});
  const aside = useRef(null);
  // the playerId whose avatar just called onWatch, so the other click of a double-click does not open the view again
  const askedAt = useRef(/** @type {{ id: string|null, at: number }} */ ({ id: null, at: 0 }));
  const phaseKey = `${pub?.phase}:${pub?.round}`;
  useEffect(() => { setOpenPid(null); }, [phaseKey, watching, observe?.observing]);
  // 同盟盟约速查（g.peek）：浮窗展开 / 收起时告知服务端，由它回各座位的干员名单
  useEffect(() => { if (onFlyToggle) onFlyToggle(bondsOpen); }, [bondsOpen]);
  // 进入新的阶段 / 回合即结束这次速查：浮窗在此收起，服务端也在同一回合 / 阶段边界丢弃订阅
  // （MatchPeek._flushPeek）——服务端这半是冗余保险，覆盖从未发送 close 的客户端
  const phaseRef = useRef(phaseKey);
  useEffect(() => {
    if (phaseRef.current === phaseKey) return;
    phaseRef.current = phaseKey;
    setBondsOpen(false);
  }, [phaseKey]);
  // 连接恢复：断线时服务端已丢弃订阅；回到对局的玩家想先看到战场，而不是一个显示着过期速查的面板
  const onlineRef = useRef(online);
  useEffect(() => {
    const was = onlineRef.current;
    onlineRef.current = online;
    if (online === true && was === false) setBondsOpen(false);
  }, [online]);
  const players = sortedPlayers(pub);
  // The flyout rows sit beside the roster rows: mirror their measured heights, so an expanded 「前往查看」 row (or a
  // line wrapping in a name) moves the flyout too instead of shifting every row after it. ResizeObserver covers the
  // expansion; the effect itself re-measures after each render that can change the roster.
  useEffect(() => {
    if (!players.length) return undefined;
    const el = aside.current;
    if (!el) return undefined;
    const anchor = () => {
      const box = el.getBoundingClientRect();
      let widest = box.width;
      for (const row of el.querySelectorAll('.team__row')) {
        widest = Math.max(widest, row.getBoundingClientRect().right - box.left);
      }
      return Math.round(widest);
    };
    // closed: the bar sits at the roster's right edge (CSS `left: 100%`), which follows the 正在查看 eye badge by
    // itself; the measured px anchor is only written while the window is open
    if (!bondsOpen) {
      el.style.removeProperty('--fly-left');
      return undefined;
    }
    let frame = null;
    // The strategy is a square as tall as the shortest roster row; the window then runs from the widest roster row
    // (the 正在查看 eye badge widens it) to the 指令 column's left edge, and the two scrolling halves (bonds /
    // operators) split what is left.
    const layout = (heights) => {
      const box = el.getBoundingClientRect();
      const bar = el.querySelector('.team__bonds-toggle')?.getBoundingClientRect().width || 44;
      const vw = globalThis.innerWidth || document.documentElement.clientWidth || 1920;
      const square = heights.length ? Math.round(Math.min(...heights)) : 64;
      const left = anchor();
      // the right-hand 指令 / 效果 column (game.js .gm__effects): keep its width free, plus a small gutter
      const fx = el.closest('.gm__hud')?.querySelector('.gm__effects') || document.querySelector('.gm__effects');
      const fxRect = fx ? fx.getBoundingClientRect() : null;
      const reserve = fxRect && fxRect.width > 0 ? Math.round(vw - fxRect.left) + 8 : 18;
      el.style.setProperty('--fly-left', `${left}px`);
      el.style.setProperty('--fly-square', `${square}px`);
      // the strategy square is a column of the window's row, so only the bar and the reserved gutter come off the width
      el.style.setProperty('--fly-w', `${Math.max(220, Math.round(vw - box.left - left - bar - reserve))}px`);
    };
    const measure = () => {
      frame = null;
      const next = {};
      for (const row of el.querySelectorAll('.team__row[data-pid]')) {
        next[row.dataset.pid] = Math.round(row.getBoundingClientRect().height * 10) / 10;
      }
      layout(Object.values(next));
      setRowH((old) => {
        const keys = Object.keys(next);
        return keys.length === Object.keys(old).length && keys.every((k) => old[k] === next[k]) ? old : next;
      });
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    for (const row of el.querySelectorAll('.team__row')) observer.observe(row);
    measure();
    globalThis.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      globalThis.removeEventListener('resize', schedule);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [bondsOpen, phaseKey, openPid, watching, players.length]);
  // A click anywhere outside the open flyout closes it — the command column, the shop, 升级 / 冻结 / 刷新, the bench,
  // 查看迎击单位, 本局信息. The roster itself (`.team`: rows, 前往查看 / 返回战场, the toggle) keeps it open, as do a
  // click in the flyout's own gaps (between rows / cells, the window's padding) and the bond popup / operator card.
  useEffect(() => {
    if (!bondsOpen) return undefined;
    const onDown = (e) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.team, .bpop, .dpanel')) return;
      setBondsOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [bondsOpen]);
  if (!players.length) return null;
  // a boss round: the viewer's pair framed in green from the round's start (item 51 — the official bg_team_border,
  // tinted like the official green; a plain green ring without the local art)
  const team = teamFrameIds(pub, myId);
  const frameArt = team.size ? localAsset('ui/battle', 'bg_team_border') : null;
  const askedRecently = (p) => askedAt.current.id === p?.playerId && Date.now() - askedAt.current.at < AVATAR_CLICK_GAP_MS;
  const noteAsked = (p) => { askedAt.current = { id: p.playerId, at: Date.now() }; };
  const click = (p, self) => {
    if (!observe) {
      // your own row still goes home; a teammate already on screen (or just opened by this double-click) does not
      if (self || teammateClickWatches({ watching, player: p, askedRecently: askedRecently(p) })) {
        if (!self) noteAsked(p);
        onWatch(p);
      }
      return;
    }
    if (self) { if (observe.observing) observe.onBack(); setOpenPid(null); return; }
    const view = observe.canObserve(p) || {};
    if (!view.fieldId) {
      setOpenPid(null);
      if (!askedRecently(p)) { noteAsked(p); onWatch(p); } // the game screen toasts the reason; a double-click toasts once
      return;
    }
    setOpenPid((cur) => (cur === p.playerId ? null : p.playerId));
  };
  const dblClick = (e, p, self) => {
    if (!prepDblClickWatches({ phase: pub?.phase, self, observe, watching, player: p, askedRecently: askedRecently(p) })) return;
    e.preventDefault();
    setOpenPid(null);
    noteAsked(p);
    onWatch(p);
  };
  return html`<aside ref=${aside} class=${cx('team', compact && 'team--compact')} aria-label=${t('同盟成员')}>
    ${players.map((p) => {
      const self = p.playerId === myId;
      const status = p.alive === false ? 'dead' : p.status;
      const meta = STATUS_META[status] || STATUS_META.acting;
      const watched = teammateFieldShown(watching, p);
      const bubble = bubbles?.get(p.playerId);
      const offline = p.connected === false && !p.isBot;
      const open = !!observe && openPid === p.playerId && !self;
      const back = !!observe && self && observe.observing;
      const title = observe ? (self ? (observe.observing ? t('返回战场') : t('你自己')) : t('查看 {name} 的战场', { name: p.name })) : (self ? t('查看自己的阵地') : t('查看 {name} 的阵地', { name: p.name }));
      const lp = rowLp(p, pub, self ? selfLive : null, { uniteLocal, cap });
      const inTeam = team.has(p.playerId);
      return html`<div key=${p.playerId} data-pid=${p.playerId} class=${cx('team__row', self && 'is-self', inTeam && 'is-team', watched && 'is-watched', p.alive === false && 'is-dead', open && 'is-open')}>
        <button type="button" class="team__btn" onClick=${() => click(p, self)} onDblClick=${(e) => dblClick(e, p, self)} title=${inTeam && !self ? `${title} · ${t('与你在同一战场')}` : title} aria-expanded=${observe && !self ? String(open) : undefined}>
          <${PlayerAvatar} player=${p} self=${self} />
          ${inTeam ? html`<span class=${cx('team__frame', !frameArt && 'team__frame--plain')} style=${frameArt ? `--frame:url("${frameArt}")` : undefined} aria-hidden="true"></span>` : null}
          <span class="team__seat num">P${(p.seat ?? 0) + 1}</span>
          ${p.isBot ? html`<span class="team__ai">AI</span>` : null}
          ${self ? html`<span class="team__you"><${Icon} name="user" /></span>` : null}
          ${spMarks?.get(p.playerId) === 'done' ? html`<span class="team__spmark is-done" title=${t('已完成选择')}><${Icon} name="check" /></span>`
            : spMarks?.get(p.playerId) === 'turn' ? html`<span class="team__spmark is-turn" title=${t('正在决策…')}><i></i><i></i><i></i></span>` : null}
        </button>
        <div class="team__info">
          <span class="team__name">${p.name || t('博士')}</span>
          <div class="team__line">
            <${LpTower} value=${lp.lp} size="sm" tone=${Number.isFinite(lp.lp) && lp.lp - lp.pending <= 5 ? 'danger' : null} pending=${lp.pending}
              tip=${rowLpTip(lp, cap)} />
            ${lp.left != null ? html`<${MissTag} n=${lp.left} name=${self ? null : p.name || t('博士')} />` : null}
            <${Tooltip} text=${offline ? t('连接已断开') : t(meta.text)} placement="right">
              <span class=${cx('team__status', `is-${meta.tone}`, offline && 'is-offline', (offline || STATUS_SPRITE[status]) && localAsset('ui/battle', offline ? 'icon_lost_connect' : STATUS_SPRITE[status]) && 'has-sprite')} aria-label=${t(meta.text)}>
                ${offline ? html`<${LocalSprite} name="icon_lost_connect" fallback=${html`<${Icon} name="wifiOff" />`} />`
                  : STATUS_SPRITE[status] ? html`<${LocalSprite} name=${STATUS_SPRITE[status]} fallback=${html`<${GIcon} name=${meta.glyph} />`} />`
                  : html`<${GIcon} name=${meta.glyph} />`}
              </span>
            <//>
            ${watched && !self ? html`<span class="team__eye" title=${t('正在查看')}><${GIcon} name="eye" /></span>` : null}
          </div>
          ${open ? html`<button type="button" class="btn btn--primary btn--sm team__ob"
            onClick=${() => { setOpenPid(null); onWatch(p); }}><span class="btn__label">${t('前往查看')}</span></button>` : null}
          ${back ? html`<button type="button" class="btn btn--secondary btn--sm team__back"
            onClick=${() => observe.onBack()}><span class="btn__label">${t('返回战场')}</span></button>` : null}
        </div>
        ${bubble ? html`<${EmoteBubble} key=${bubble.seq} id=${bubble.id} class="team__bubble" />` : null}
      </div>`;
    })}
    <${BondsFlyout} players=${players} myId=${myId} open=${bondsOpen} onToggle=${() => setBondsOpen((o) => !o)}
      onBond=${onBond} flyOps=${flyOps} onOp=${onOp} rowH=${rowH} layersDisabled=${layersDisabled} />
  </aside>`;
}
