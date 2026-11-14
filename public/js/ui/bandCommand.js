// Server-approved targets and command state are authoritative, including after reconnect.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Tooltip, Modal, Button } from './components.js';
import { BandIcon, RichText } from './gameComponents.js';
import { actions } from './gameActions.js';
import { toast } from './toasts.js';
import { data, localAsset } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { GEO } from '../../../shared/constants.js';

export function commandUnlock(c) {
  const [n, count] = c.unlockParam || [];
  if (c.unlockType === 'band_skill_load_by_round') return t('第 {n} 回合解锁', { n });
  if (c.unlockType === 'band_skill_load_by_shop_lv') return t('调度中心 {n} 阶解锁', { n });
  if (c.unlockType === 'band_skill_load_by_coin_cost') return t('累计消耗 {n} 资金解锁', { n });
  if (c.unlockType === 'band_skill_load_by_bond_act_count') return t('{bond}达到 {n} 人解锁', { bond: data.lookup('bonds', n)?.name || n, n: count });
  return t('尚未解锁');
}

export function commandStatus(c) {
  if (c.reason === 'locked') return commandUnlock(c);
  if (c.reason === 'passive') return t('被动效果');
  if (c.reason === 'funds') return t('资金不足');
  if (c.reason === 'specialRecruit') return t('招募选择期间不可使用指令');
  if (c.cooldown) return t('指令冷却：{n} 回合', { n: c.cooldown });
  if (c.usesLeft != null) return t('指令剩余：{n} 次', { n: c.usesLeft });
  return t('可使用');
}

/** PRTS expands replacement text; [ASSUMED] the two rows without a replacement render an empty tag, as on PRTS. */
export function commandText(c) {
  const band = Object.values(data.get('bands') || {}).find(b => b.skills?.some(s => s.effectId === c.effectId));
  const raw = c.descRaw || c.desc || '';
  const extra = raw.includes('{@tag}') ? (band?.descRaw || '').match(/(?:<@[^>]+>)?<在场6名不同[^>]*>[\s\S]*/)?.[0] || '' : '';
  // The unlock sentence already occurs in the skill row; the full strategy text supplies it for the locked row.
  const unlock = raw.includes('{@unlock}') && c.type === 'NONE' ? (band?.descRaw || '').split('\n').at(-1) : '';
  return [raw.replaceAll('{@tag}', '').replaceAll('{@unlock}', ''), extra, unlock].filter(Boolean).join('\n');
}

const STYLE = { color: 0x7fffc9, fill: 0.24, line: 2, group: 'command' };
/**
 * The target under the pointer while the command is dragged: its tile turns from the targets' mint to orange — the drop
 * lands there (the owner, 2026-11-14: an arrow from the strategy following the mouse, a mark on the tile under it, or the
 * operator's foot square turning orange — 「你来决定」: the arrow and the orange square, §37.201).
 */
const HOVER = { color: 0xff9a3c, fill: 0.42, line: 3, group: 'command-hover' };
/** CSS px between two chevrons of the aiming arrow. */
export const AIM_STEP = 26;

/**
 * The aiming arrow's chevrons: a quadratic curve from the command button's centre (sx, sy) to the pointer (tx, ty),
 * bowed up-screen by a fifth of its length (at most 160 px); one chevron every AIM_STEP px, the last at the pointer,
 * each turned along the curve (`a`, radians, 0 = pointing right). Pure; [] for a pointer on the button.
 * @returns {{ x: number, y: number, a: number }[]}
 */
export function aimPath(sx, sy, tx, ty, step = AIM_STEP) {
  const dx = tx - sx, dy = ty - sy, len = Math.hypot(dx, dy);
  if (!(len > 8)) return [];
  const bow = Math.min(160, len * 0.2);
  let nx = -dy / len, ny = dx / len;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const cx = (sx + tx) / 2 + nx * bow, cy = (sy + ty) / 2 + ny * bow;
  const n = Math.max(2, Math.round(len / step));
  const out = [];
  for (let i = 1; i <= n; i++) {
    const k = i / n, u = 1 - k;
    out.push({
      x: u * u * sx + 2 * u * k * cx + k * k * tx,
      y: u * u * sy + 2 * u * k * cy + k * k * ty,
      a: Math.atan2(2 * u * (cy - sy) + 2 * k * (ty - cy), 2 * u * (cx - sx) + 2 * k * (tx - cx)),
    });
  }
  return out;
}

/**
 * The arrow's DOM (on document.body: the HUD's transformed boxes must not move it), drawn with the official chevron
 * (ui/battle fx_arrow, the client's drag arrow piece) as a mask — mint, orange over a target; a CSS chevron without it.
 */
function aimLayer() {
  const el = document.createElement('div');
  el.className = 'cmd-aim';
  el.setAttribute('aria-hidden', 'true');
  const url = localAsset('ui/battle', 'fx_arrow');
  if (url) el.style.setProperty('--cmd-aim-art', `url("${url}")`);
  else el.classList.add('is-plain');
  document.body.appendChild(el);
  return el;
}

function drawAim(el, from, to, on) {
  const pts = aimPath(from.x, from.y, to.x, to.y);
  while (el.childElementCount < pts.length) el.appendChild(document.createElement('i'));
  while (el.childElementCount > pts.length) el.lastElementChild.remove();
  pts.forEach((p, i) => {
    const c = /** @type {HTMLElement} */ (el.children[i]);
    c.className = i === pts.length - 1 ? 'cmd-aim__c is-tip' : 'cmd-aim__c';
    c.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${(p.a + Math.PI / 2).toFixed(3)}rad)`;
  });
  el.classList.toggle('is-on', !!on);
}

function inside(x, y, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = poly[i], [c, d] = poly[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit;
  }
  return hit;
}

/** @param {{ command:any, priv:any, view:any, editable:boolean }} props */
export function BandCommand({ command: c, priv, view, editable }) {
  const [drag, setDrag] = useState(false), [busy, setBusy] = useState(false);
  const pending = useRef(false), pointer = useRef(null);
  const tiles = (c.targets || []).flatMap(target => {
    if (target.row != null) return [[target.row, target.col]];
    if (target.uid == null) return [];
    const board = priv.board?.find(p => p.uid === target.uid);
    if (board) return [[board.row, board.col]];
    const idx = priv.hand?.findIndex(p => p?.uid === target.uid);
    return idx >= 0 ? [[GEO.HAND_ROW, idx]] : [];
  });
  useEffect(() => {
    if (!drag) return;
    view?.highlightTiles(tiles, STYLE);
    const cards = (c.targets || []).filter(t => t.slot != null).flatMap(t => [...document.querySelectorAll(`[data-shop-slot="${t.slot}"]`)]);
    cards.forEach(e => e.classList.add('is-command-target'));
    return () => { view?.highlightTiles([], STYLE); cards.forEach(e => e.classList.remove('is-command-target')); };
  }, [drag, c.effectId, view]);
  const send = async target => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { if (await actions.command(c.effectId, target)) toast(t('指令已使用'), 'success'); }
    finally { pending.current = false; setBusy(false); }
  };
  const canUse = editable && c.usable && !busy;
  const reject = () => toast(c.reason ? commandStatus(c) : t('当前阶段无法进行该操作'), 'warn');
  /** The valid target under a client point (the drop's own test). */
  const targetAt = (x, y) => {
    if (c.targetType === 'SHOP_SLOT') {
      const slot = document.elementFromPoint(x, y)?.closest('[data-shop-slot]')?.getAttribute('data-shop-slot');
      return slot != null ? c.targets.find(t => t.slot === Number(slot)) || null : null;
    }
    if (c.targetType === 'COMMON_CHESS') {
      const uid = view?.pieceAtClientPoint(x, y);
      return c.targets.find(t => t.uid === (uid?.uid ?? uid)) || null;
    }
    return c.targets.find(t => { const geo = view?.tileScreen(t.row, t.col); return geo?.poly && inside(x, y, geo.poly); }) || null;
  };
  /** The tile of a target (a board / hand piece's, or its own), for the orange square. */
  const tileOf = (target) => {
    if (!target) return null;
    if (target.row != null) return [target.row, target.col];
    if (target.uid == null) return null;
    const board = priv.board?.find(p => p.uid === target.uid);
    if (board) return [board.row, board.col];
    const idx = priv.hand?.findIndex(p => p?.uid === target.uid);
    return idx >= 0 ? [GEO.HAND_ROW, idx] : null;
  };
  // the aiming arrow and the hovered target while dragging (refs: pointermove runs outside renders)
  const aim = useRef(/** @type {{ el: HTMLElement|null, from: {x:number,y:number}, hover: any, cards: Element[], frame: number|null, at: {x:number,y:number}|null }|null} */ (null));
  const showHover = (target) => {
    const a = aim.current;
    if (!a || a.hover === target) return;
    a.hover = target;
    const tile = tileOf(target);
    view?.highlightTiles(tile ? [tile] : [], HOVER);
    a.cards.forEach(e => e.classList.remove('is-command-hover'));
    a.cards = target?.slot != null ? [...document.querySelectorAll(`[data-shop-slot="${target.slot}"]`)] : [];
    a.cards.forEach(e => e.classList.add('is-command-hover'));
  };
  const stopAim = () => {
    const a = aim.current;
    if (!a) return;
    if (a.frame != null) cancelAnimationFrame(a.frame);
    a.el?.remove();
    a.cards.forEach(e => e.classList.remove('is-command-hover'));
    view?.highlightTiles([], HOVER);
    aim.current = null;
  };
  useEffect(() => stopAim, []);
  useEffect(() => { setDrag(false); pointer.current = null; stopAim(); }, [editable, c.effectId]);
  const start = e => {
    e.stopPropagation();
    if (e.button !== 0 || c.targetType === 'NO_TARGET') return;
    if (!canUse) { reject(); return; }
    e.preventDefault(); pointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId); setDrag(true);
    const r = e.currentTarget.getBoundingClientRect();
    stopAim();
    aim.current = { el: aimLayer(), from: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, hover: null, cards: [], frame: null, at: null };
  };
  const move = e => {
    const a = aim.current;
    if (!a || pointer.current !== e.pointerId) return;
    a.at = { x: e.clientX, y: e.clientY };
    if (a.frame != null) return;
    a.frame = requestAnimationFrame(() => {
      const b = aim.current;
      if (!b || !b.at) return;
      b.frame = null;
      const target = targetAt(b.at.x, b.at.y);
      showHover(target);
      if (b.el) drawAim(b.el, b.from, b.at, !!target);
    });
  };
  const finish = e => {
    if (pointer.current !== e.pointerId) return;
    e.stopPropagation(); pointer.current = null; setDrag(false);
    stopAim();
    if (!canUse) return;
    const target = targetAt(e.clientX, e.clientY);
    if (target) void send(target); else toast(t('请拖到高亮的有效目标'), 'warn');
  };
  return html`<${Tooltip} placement="bottom" text=${html`<div class="efftip"><b>${t('指令')}</b><${RichText} as="p" text=${commandText(c)} />
    <p>${commandStatus(c)}</p>${c.type === 'ACTIVE' ? html`<p>${c.targetType === 'NO_TARGET' ? t('点击使用') : t('拖动指令到高亮目标')}</p>` : null}</div>`}>
    <button type="button" class=${`band-command ${canUse ? '' : 'is-unavailable'} ${drag ? 'is-dragging' : ''}`}
      data-testid="band-command" aria-label=${t('指令')} aria-disabled=${!canUse} aria-busy=${busy}
      onPointerDown=${start} onPointerMove=${move} onPointerUp=${finish} onPointerCancel=${() => { pointer.current = null; setDrag(false); stopAim(); }}
      onClick=${e => { e.stopPropagation(); if (c.targetType === 'NO_TARGET') { if (canUse) void send({}); else reject(); } }}>
      <${BandIcon} bandId=${c.bandId} /><span><b>${t('指令')}${c.type === 'ACTIVE' ? ` · ${t('消耗 {n}', { n: c.currentCost })}` : ''}</b>
      <small>${commandStatus(c)}</small></span>
    </button>
  <//>`;
}

export function CommandDraft({ draft }) {
  const [busy, setBusy] = useState(false);
  return html`<${Modal} open=${true} title=${t('更换指令')} closeOnBackdrop=${false} width="min(92vw, 48rem)">
    <div class="command-draft">${draft.cards.map((c, idx) => html`<div class="command-draft__card" key=${c.effectId}>
      <${RichText} as="p" text=${commandText(c)} /><p>${t('消耗 {n}', { n: c.cost })}</p>
      <${Button} disabled=${busy} onClick=${async () => { setBusy(true); await actions.commandChoice(draft.id, idx); setBusy(false); }}>${t('选择')}</${Button}>
    </div>`)}</div>
  </${Modal}>`;
}
