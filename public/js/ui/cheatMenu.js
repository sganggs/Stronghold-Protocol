// Floating cheat menu (debug overlay). A small draggable pill that expands into a panel with
// server-side cheat toggles: 无限资金 (infinite funds), +10000 资金, 商店满级, 免费刷新×99.
//
// Every action goes through `g.cheat` (server/match/PlayerState.cheat); the panel reads the
// authoritative cheat state back from `m.private.cheat` so the toggle reflects the server. The
// menu is always mounted (main.js App) but only interactive once a match's private state exists;
// outside a match it shows a disabled hint. Position is persisted in localStorage.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel } from './components.js';
import { net } from '../net.js';
import { store, useStore, loadPref, savePref } from '../store.js';
import { toast } from './toasts.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const POS_KEY = 'cheat.menu.pos';
const DEFAULT_POS = { x: 16, y: 80 };

/** Clamp a position inside the viewport (the pill / panel stays on-screen). */
function clampPos(x, y, w = 56, h = 56) {
  const maxX = Math.max(0, window.innerWidth - w - 4);
  const maxY = Math.max(0, window.innerHeight - h - 4);
  return { x: Math.min(Math.max(4, x), maxX), y: Math.min(Math.max(4, y), maxY) };
}

/** Send a cheat intent; never throws (shows a toast on error like gameActions.act). */
async function cheat(action, fields = {}) {
  try {
    await net.request('g.cheat', { action, ...fields });
    return true;
  } catch (err) {
    toast(`作弊失败：${err?.message || err}`, 'error');
    return false;
  }
}

/**
 * The floating cheat menu. Mounted once in App; reads `match.private.cheat` for toggle state.
 */
export function CheatMenu() {
  const priv = useStore((s) => s.match?.private ?? null);
  const inMatch = useStore((s) => !!s.match?.public);
  const infinite = !!priv?.cheat?.infiniteFunds;
  const funds = Number(priv?.funds) || 0;

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(() => loadPref(POS_KEY, DEFAULT_POS));
  const [busy, setBusy] = useState(false);
  const dragRef = useRef(null);

  // persist position
  useEffect(() => { savePref(POS_KEY, pos); }, [pos]);

  // drag handling (pointer events, works on mouse + touch)
  useEffect(() => {
    const el = dragRef.current;
    if (!el) return undefined;
    let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false, pointerId = null;

    const onDown = (e) => {
      // only drag from the header (the pill itself or the panel title bar), not from buttons
      if (e.target.closest('.cheat__btn, .cheat__row, .cheat__toggle')) return;
      dragging = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      origX = pos.x;
      origY = pos.y;
      el.setPointerCapture?.(pointerId);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setPos(clampPos(origX + dx, origY + dy, open ? 260 : 56, open ? 300 : 56));
    };
    const onUp = () => { dragging = false; pointerId = null; };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [pos, open]);

  const run = async (action, fields, label) => {
    if (busy) return;
    setBusy(true);
    const ok = await cheat(action, fields);
    setBusy(false);
    if (ok && label) toast(label, 'success');
  };

  const style = { left: `${pos.x}px`, top: `${pos.y}px` };

  // collapsed: a small draggable pill with a crown icon
  if (!open) {
    return html`<div class=${cx('cheat', 'cheat--pill', !inMatch && 'is-dim')} style=${style} ref=${dragRef}
        title="作弊菜单（拖拽移动，点击展开）">
      <button type="button" class="cheat__pill-btn" onClick=${() => setOpen(true)} aria-label="展开作弊菜单">
        <${Icon} name="crown" />
      </button>
    </div>`;
  }

  // expanded panel
  return html`<div class=${cx('cheat', 'cheat--panel', !inMatch && 'is-dim')} style=${style} ref=${dragRef}>
    <div class="cheat__head">
      <${Icon} name="crown" class="cheat__head-icon" />
      <span class="cheat__title">作弊菜单</span>
      <${MicroLabel} tone="mint">CHEAT</${MicroLabel}>
      <button type="button" class="cheat__close" onClick=${() => setOpen(false)} aria-label="收起">
        <${Icon} name="close" />
      </button>
    </div>

    <div class="cheat__body">
      ${!inMatch ? html`<div class="cheat__hint">需进入对局后使用</div>` : null}

      <div class="cheat__row">
        <label class="cheat__toggle">
          <input type="checkbox" checked=${infinite} disabled=${!inMatch || busy}
            onChange=${(e) => run('infiniteFunds', { on: e.target.checked }, e.target.checked ? '无限资金已开启' : '无限资金已关闭')} />
          <span class="cheat__slider"></span>
          <span class="cheat__label">无限资金</span>
        </label>
        <span class=${cx('cheat__funds num', infinite && 'is-on')}>${funds}</span>
      </div>

      <button type="button" class="cheat__btn" disabled=${!inMatch || busy}
        onClick=${() => run('addFunds', { amount: 10000 }, '+10000 资金')}>
        <${Icon} name="plus" /> +10000 资金
      </button>

      <button type="button" class="cheat__btn" disabled=${!inMatch || busy}
        onClick=${() => run('addFunds', { amount: 100000 }, '+100000 资金')}>
        <${Icon} name="plus" /> +100000 资金
      </button>

      <button type="button" class="cheat__btn" disabled=${!inMatch || busy}
        onClick=${() => run('maxLevel', {}, '调度中心已满级')}>
        <${Icon} name="rook" /> 商店满级
      </button>

      <button type="button" class="cheat__btn" disabled=${!inMatch || busy}
        onClick=${() => run('refreshFree', {}, '免费刷新 ×99')}>
        <${Icon} name="refresh" /> 免费刷新 ×99
      </button>
    </div>

    <div class="cheat__foot">
      <span class="cheat__foot-label">拖拽标题栏移动</span>
    </div>
  </div>`;
}
