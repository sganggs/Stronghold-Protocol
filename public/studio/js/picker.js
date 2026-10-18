// public/studio/js/picker.js — finding what to change by its official name (DESIGN §32.9): a search box over the server's
// target index (GET /studio/api/targets — server/studio/targets.js: operators, summons, enemies, items, bonds, strategies,
// interface pictures, music, sounds), each result with its picture, its name and its kind; the author never types an
// internal id (it is shown small for those who want it).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from '../../js/ui/components.js';
import { t } from '../../../shared/i18n.js';
import { get } from './api.js';
import { kindLabel, targetName } from './labels.js';

const cx = (...p) => p.filter(Boolean).join(' ');

/**
 * The search (see the header).
 * @param {{ kinds: string[], onPick: (target: any) => void, selected?: any, autoFocus?: boolean, placeholder?: string, targets?: any[] }} props
 *   kinds: the kinds offered (a template's); selected: the target picked now
 */
export function TargetPicker({ kinds, onPick, selected = null, autoFocus = false, placeholder = '', targets = null }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(kinds.length === 1 ? kinds[0] : '');
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const req = useRef(0);
  const input = useRef(null);
  useEffect(() => { if (autoFocus) input.current?.focus(); }, []);
  useEffect(() => {
    const n = ++req.current;
    setBusy(true);
    if (targets) {
      const query = q.trim().toLocaleLowerCase();
      setList(targets.filter(t => (!kind || t.kind === kind) && `${t.name} ${t.key}`.toLocaleLowerCase().includes(query)).slice(0, 60));
      setBusy(false); return undefined;
    }
    const timer = setTimeout(() => {
      get(`targets?q=${encodeURIComponent(q)}&kinds=${encodeURIComponent(kind || kinds.join(','))}&limit=60`)
        .then((r) => { if (n === req.current) setList(r.targets || []); })
        .catch(() => { if (n === req.current) setList([]); })
        .finally(() => { if (n === req.current) setBusy(false); });
    }, 160);
    return () => clearTimeout(timer);
  }, [q, kind, kinds.join(','), targets]);
  return html`<div class="st-picker" data-testid="target-picker">
    <div class="st-picker__row">
      <input ref=${input} class="st-input" type="search" value=${q} placeholder=${placeholder || t('输入官方名字搜索，例如「德克萨斯」')}
        onInput=${(e) => setQ(e.currentTarget.value)} data-testid="target-search" />
    </div>
    ${kinds.length > 1 ? html`<div class="st-chips">
      <button type="button" class=${cx('st-chip', !kind && 'is-on')} onClick=${() => setKind('')}>${t('全部')}</button>
      ${kinds.map((k) => html`<button type="button" key=${k} class=${cx('st-chip', kind === k && 'is-on')} onClick=${() => setKind(k)}>${kindLabel(k)}</button>`)}
    </div>` : null}
    <ul class=${cx('st-picker__list', busy && 'is-busy')}>
      ${list.map((tg) => html`<li key=${`${tg.kind}:${tg.key}`}>
        <button type="button" class=${cx('st-target', selected && selected.kind === tg.kind && selected.key === tg.key && 'is-on')}
            onClick=${() => onPick(tg)} data-target=${`${tg.kind}:${tg.key}`}>
          <span class="st-target__icon">${tg.icon ? html`<img src=${tg.icon} alt="" loading="lazy" />` : html`<span>${kindLabel(tg.kind).slice(0, 1)}</span>`}</span>
          <span class="st-target__text">
            <span class="st-target__name">${targetName(tg)}</span>
            <span class="st-target__meta">${kindLabel(tg.kind)} · <code>${tg.key}</code></span>
          </span>
        </button>
      </li>`)}
      ${!busy && !list.length ? html`<li class="st-none">${t('没有找到。换个名字试试，或者切换上面的类别。')}</li>` : null}
    </ul>
  </div>`;
}
