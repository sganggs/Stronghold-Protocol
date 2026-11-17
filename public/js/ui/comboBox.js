// Custom listbox combobox for player-facing choices that do not fit a segmented row
// (language packs beyond SEGMENTED_MAX, 潜能, 此干员语音, 按盟约筛选, a plugin enum).
// Focus stays on the button (ARIA combobox + listbox). The list is positioned fixed so a
// scrolling dialog does not clip it.
//
// [ASSUMED] The official client draws its own dropdown. This one reuses the segmented
// control's colours and the protocol-card frame already in the new screens. No official
// spec settles the keyboard map; it follows the APG select-only combobox, with the first
// ArrowUp / ArrowDown opening onto the current value instead of jumping to an end.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';

const cx = (...parts) => parts.flat().filter(Boolean).join(' ');
const TYPEAHEAD_MS = 500;
let seq = 0;

/**
 * One key against a combobox. `state` is `{ open, active, query, queryAt }`.
 * `key` is `{ key, altKey, ctrlKey, metaKey, time }`. `opts.options` is
 * `{ value, label, disabled? }[]`. `opts.typeaheadMs` defaults to 500.
 * Returns the next state plus `commit` (the value, which may be `''`; omitted when
 * nothing was chosen), `prevent`, `close` and `focusReturn` (Esc / commit: focus
 * goes back to the combobox, which already holds it).
 * Arrows do not wrap. Home / End jump. Type-ahead prefers a label that starts with
 * the buffer, then one that contains it, searching from the next option when the
 * buffer starts fresh and from the current option while it is still growing.
 * @param {{ open?: boolean, active?: number, query?: string, queryAt?: number }} state
 * @param {{ key?: string, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, time?: number }} key
 * @param {{ options?: { value: string, label?: string, disabled?: boolean }[], typeaheadMs?: number }} [opts]
 */
export function comboMove(state, key, opts = {}) {
  const options = Array.isArray(opts.options) ? opts.options : [];
  const n = options.length;
  const typeaheadMs = Number.isFinite(opts.typeaheadMs) ? opts.typeaheadMs : TYPEAHEAD_MS;
  const time = Number.isFinite(key?.time) ? key.time : 0;
  const active = Number.isInteger(state?.active) ? state.active : -1;
  const open = !!state?.open;
  const query = typeof state?.query === 'string' ? state.query : '';
  const queryAt = Number.isFinite(state?.queryAt) ? state.queryAt : 0;
  const out = { open, active: n ? Math.max(-1, Math.min(n - 1, active)) : -1, query, queryAt, prevent: false, close: false, focusReturn: false };
  if (!n || key?.ctrlKey || key?.metaKey) return out;
  const k = key?.key || '';
  const stay = (i, nextOpen = true) => {
    out.active = i;
    out.open = nextOpen;
    out.prevent = true;
    out.query = '';
  };
  if (k === 'ArrowDown' && key.altKey) { out.open = true; out.prevent = true; if (out.active < 0) out.active = 0; return out; }
  if (k === 'ArrowUp' && key.altKey) {
    const i = out.active >= 0 ? out.active : 0;
    out.commit = options[i]?.value;
    out.open = false;
    out.close = true;
    out.prevent = true;
    out.focusReturn = true;
    return out;
  }
  if (k === 'Escape') {
    if (open) { out.open = false; out.close = true; out.prevent = true; out.focusReturn = true; }
    return out;
  }
  if (k === 'Tab') { out.open = false; out.close = open; return out; }
  if (k === 'ArrowDown') {
    if (!open) stay(out.active >= 0 ? out.active : 0);
    else stay(Math.min(n - 1, (out.active < 0 ? 0 : out.active) + 1));
    return out;
  }
  if (k === 'ArrowUp') {
    if (!open) stay(out.active >= 0 ? out.active : n - 1);
    else stay(Math.max(0, (out.active < 0 ? 0 : out.active) - 1));
    return out;
  }
  if (k === 'Home') { stay(0); return out; }
  if (k === 'End') { stay(n - 1); return out; }
  if (k === 'Enter' || k === ' ') {
    if (!open) { stay(out.active >= 0 ? out.active : 0); return out; }
    const i = out.active >= 0 ? out.active : 0;
    if (options[i]?.disabled) { out.prevent = true; return out; }
    out.commit = options[i]?.value;
    out.open = false;
    out.close = true;
    out.prevent = true;
    out.focusReturn = true;
    return out;
  }
  if (k.length === 1 && !key.altKey) {
    const fresh = time - queryAt > typeaheadMs;
    const nextQuery = `${fresh ? '' : query}${k}`.toLowerCase();
    const from = fresh ? ((out.active < 0 ? -1 : out.active) + 1) % n : (out.active < 0 ? 0 : out.active);
    const hit = findTypeahead(options, nextQuery, from);
    out.query = nextQuery;
    out.queryAt = time;
    out.open = true;
    out.prevent = true;
    if (hit >= 0) out.active = hit;
    return out;
  }
  return out;
}

function findTypeahead(options, query, start) {
  const labels = options.map((o) => String(o?.label ?? o?.value ?? '').toLowerCase());
  const n = labels.length;
  const at = (pred) => {
    for (let step = 0; step < n; step++) {
      const i = (start + step) % n;
      if (!options[i]?.disabled && pred(labels[i])) return i;
    }
    return -1;
  };
  const starts = at((label) => label.startsWith(query));
  return starts >= 0 ? starts : at((label) => label.includes(query));
}

/**
 * Button + listbox. `value` is controlled. `onChange` receives `{ currentTarget: { value } }`
 * so a caller that used to read a native select keeps working. `options` is
 * `{ value, label, lang?, title?, dataLang?, disabled? }[]`.
 * @param {{ label?: string, value?: string|number, options?: any[], onChange?: Function, disabled?: boolean,
 *   class?: string, testId?: string, id?: string, dataCult?: string, setting?: string }} props
 * `data-cult` is the same attribute the roster tests and the loadout rows already use.
 */
export function ComboBox(props) {
  const { label, value, options = [], onChange, disabled = false, class: cls = '', testId, setting } = props;
  const dataCult = props.dataCult ?? props['data-cult'];
  const list = Array.isArray(options) ? options : [];
  const idRef = useRef('');
  if (!idRef.current) idRef.current = `sp-combo-${++seq}`;
  const listId = `${idRef.current}-list`;
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const selected = list.findIndex((o) => String(o.value) === String(value ?? ''));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const [query, setQuery] = useState('');
  const [queryAt, setQueryAt] = useState(0);
  const current = list.find((o) => String(o.value) === String(value ?? ''));

  const apply = (next) => {
    setOpen(next.open);
    setActive(next.active);
    setQuery(next.query);
    setQueryAt(next.queryAt);
    if (Object.hasOwn(next, 'commit')) onChange?.({ currentTarget: { value: next.commit == null ? '' : String(next.commit) }, target: { value: next.commit == null ? '' : String(next.commit) } });
    if (next.focusReturn) btnRef.current?.focus?.();
  };
  const onKey = (e) => {
    if (disabled) return;
    const next = comboMove(
      { open, active: active >= 0 ? active : selected, query, queryAt },
      { key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, time: typeof performance !== 'undefined' ? performance.now() : Date.now() },
      { options: list },
    );
    if (next.prevent) e.preventDefault();
    if (next.prevent || next.close) e.stopPropagation();
    apply(next);
  };
  const commit = (v) => apply({ ...comboMove({ open: true, active, query, queryAt }, { key: 'Enter' }, { options: list }), commit: v, open: false, close: true, focusReturn: true });

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);
  useEffect(() => {
    if (!open || !btnRef.current || !listRef.current) return undefined;
    const place = () => {
      const r = btnRef.current.getBoundingClientRect();
      const box = listRef.current;
      const room = Math.max(120, Math.min(320, window.innerHeight - r.bottom - 8));
      box.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8))}px`;
      box.style.top = `${r.bottom + 4}px`;
      box.style.width = `${Math.max(r.width, 160)}px`;
      box.style.maxHeight = `${room}px`;
    };
    place();
    const el = listRef.current.querySelector('.is-active');
    el?.scrollIntoView?.({ block: 'nearest' });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, active]);

  return html`<div ref=${rootRef} class=${cx('combo', cls)} data-testid=${testId || undefined} data-cult=${dataCult || undefined} data-setting=${setting || undefined}>
    <button type="button" ref=${btnRef} class="combo__btn" role="combobox" aria-expanded=${open ? 'true' : 'false'} aria-controls=${listId}
      aria-activedescendant=${open && active >= 0 ? `${listId}-o${active}` : undefined} aria-label=${label || undefined}
      disabled=${disabled || undefined} data-value=${value ?? ''} onClick=${() => { if (!disabled) { setOpen((v) => !v); setActive(selected >= 0 ? selected : 0); } }} onKeyDown=${onKey}>
      <span class="combo__val">${current?.label ?? ''}</span>
      <${Icon} name="chevronRight" class="combo__chev" />
    </button>
    <ul ref=${listRef} id=${listId} role="listbox" class=${cx('combo__list', open && 'is-open')} hidden=${open ? undefined : true} aria-label=${label || undefined}>
      ${list.map((o, i) => html`<li key=${`${o.value}|${i}`} id=${`${listId}-o${i}`} role="option" aria-selected=${String(o.value) === String(value ?? '') ? 'true' : 'false'}
        aria-disabled=${o.disabled ? 'true' : undefined} data-value=${o.value} data-lang=${o.dataLang || undefined} lang=${o.lang || undefined} title=${o.title || undefined}
        class=${cx('combo__opt', i === active && 'is-active', String(o.value) === String(value ?? '') && 'is-on', o.disabled && 'is-off')}
        onMouseEnter=${() => setActive(i)} onMouseDown=${(e) => { e.preventDefault(); if (!o.disabled) commit(o.value); }}>${o.label}</li>`)}
    </ul>
  </div>`;
}
