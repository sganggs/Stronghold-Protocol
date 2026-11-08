// Server-approved targets and command state are authoritative, including after reconnect.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Tooltip, Modal, Button } from './components.js';
import { BandIcon, RichText } from './gameComponents.js';
import { actions } from './gameActions.js';
import { toast } from './toasts.js';
import { data } from '../data.js';
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
  useEffect(() => { setDrag(false); pointer.current = null; }, [editable, c.effectId]);
  const send = async target => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { if (await actions.command(c.effectId, target)) toast(t('指令已使用'), 'success'); }
    finally { pending.current = false; setBusy(false); }
  };
  const canUse = editable && c.usable && !busy;
  const reject = () => toast(c.reason ? commandStatus(c) : t('当前阶段无法进行该操作'), 'warn');
  const start = e => {
    e.stopPropagation();
    if (e.button !== 0 || c.targetType === 'NO_TARGET') return;
    if (!canUse) { reject(); return; }
    e.preventDefault(); pointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId); setDrag(true);
  };
  const finish = e => {
    if (pointer.current !== e.pointerId) return;
    e.stopPropagation(); pointer.current = null; setDrag(false);
    if (!canUse) return;
    let target;
    if (c.targetType === 'SHOP_SLOT') {
      const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-shop-slot]')?.getAttribute('data-shop-slot');
      if (slot != null) target = c.targets.find(t => t.slot === Number(slot));
    } else if (c.targetType === 'COMMON_CHESS') {
      const uid = view?.pieceAtClientPoint(e.clientX, e.clientY);
      target = c.targets.find(t => t.uid === (uid?.uid ?? uid));
    } else {
      target = c.targets.find(t => { const geo = view?.tileScreen(t.row, t.col); return geo?.poly && inside(e.clientX, e.clientY, geo.poly); });
    }
    if (target) void send(target); else toast(t('请拖到高亮的有效目标'), 'warn');
  };
  return html`<${Tooltip} placement="bottom" text=${html`<div class="efftip"><b>${t('指令')}</b><${RichText} as="p" text=${commandText(c)} />
    <p>${commandStatus(c)}</p>${c.type === 'ACTIVE' ? html`<p>${c.targetType === 'NO_TARGET' ? t('点击使用') : t('拖动指令到高亮目标')}</p>` : null}</div>`}>
    <button type="button" class=${`band-command ${canUse ? '' : 'is-unavailable'} ${drag ? 'is-dragging' : ''}`}
      data-testid="band-command" aria-label=${t('指令')} aria-disabled=${!canUse} aria-busy=${busy}
      onPointerDown=${start} onPointerUp=${finish} onPointerCancel=${() => { pointer.current = null; setDrag(false); }}
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
