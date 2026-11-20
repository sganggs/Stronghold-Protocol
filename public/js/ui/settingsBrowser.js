import { useId, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel } from './components.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
import { matchesSetting, settingsSearchText } from './settingsSearch.js';

/** Keep the real controls mounted while categories/search change, including imports and diagnostic reports. */
export function SettingsBrowser({ categories, entries }) {
  const uid = useId();
  const [category, setCategory] = useState(categories[0].id);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState([]);
  const content = useRef(null), search = useRef(null), nav = useRef(null), signature = useRef('');
  const searching = !!settingsSearchText(query);
  const tabId = id => `${uid}-settings-tab-${id}`;
  const panelId = `${uid}-settings-panel`;

  // Index the actual labels/hints, so translations, asynchronously available FX and plugin/theme names stay current.
  // Hidden category containers are included; empty conditional controls are omitted. Attribute changes (hidden,
  // aria-selected, values) do not trigger this observer. Text/children change only rebuild the small index if needed.
  useLayoutEffect(() => {
    const root = content.current;
    if (!root) return undefined;
    const read = () => {
      const next = [...root.querySelectorAll('[data-setting-id]')].map(el => ({
        id: el.dataset.settingId, text: el.textContent.trim(),
      }));
      const key = JSON.stringify(next);
      if (signature.current !== key) { signature.current = key; setIndex(next); }
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => { if (content.current) content.current.scrollTop = 0; }, [category, query]);

  const indexed = new Map(index.map(item => [item.id, item.text]));
  const matched = new Set(entries.filter(entry => {
    const text = indexed.get(entry.id);
    const group = categories.find(c => c.id === entry.category);
    return text != null && text.length > 0 && matchesSetting(`${tc('settings-category', group.label)} ${group.micro} ${text}`, query);
  }).map(entry => entry.id));
  const show = entry => searching ? matched.has(entry.id)
    : category === entry.category && (indexed.get(entry.id) == null || indexed.get(entry.id).length > 0);
  const choose = id => { setCategory(id); setQuery(''); };
  const clear = () => { setQuery(''); search.current?.focus(); };
  const tabs = [...(searching ? [{id:'search', label:N_('搜索结果'), micro:'SEARCH'}] : []), ...categories];
  const activeTab = searching ? 'search' : category;
  useLayoutEffect(() => { nav.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'}); }, [activeTab]);

  return html`<div class="settings-browser">
    <div class="settings-search">
      <label class="settings-search__field">
        <${Icon} name="search" />
        <input ref=${search} type="search" value=${query} maxLength="128" autoComplete="off" spellCheck=${false}
          aria-label=${t('搜索设置')} placeholder=${t('搜索设置名称或说明')} data-testid="settings-search"
          onInput=${e => setQuery(e.currentTarget.value)} onKeyDown=${e => {
            if (e.key === 'Escape' && query && !e.isComposing) { e.preventDefault(); e.stopPropagation(); clear(); }
          }} />
      </label>
      ${query ? html`<button type="button" class="settings-search__clear" aria-label=${t('清空搜索')} onClick=${clear}><${Icon} name="close" /><span>${t('清空搜索')}</span></button>` : null}
    </div>
    <div class="settings-layout">
      <nav ref=${nav} class="settings-nav" role="tablist" aria-label=${t('设置分类')} aria-orientation="vertical" onKeyDown=${e => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        const buttons = [...e.currentTarget.querySelectorAll('[role="tab"]')];
        const i = buttons.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        e.preventDefault(); buttons[next].focus(); buttons[next].click();
      }}>
        ${tabs.map((c, i) => html`<button key=${c.id} type="button" id=${tabId(c.id)} role="tab" aria-controls=${panelId}
          aria-selected=${activeTab === c.id} tabIndex=${activeTab === c.id ? 0 : -1} data-settings-tab=${c.id}
          class=${`settings-nav__item${activeTab === c.id ? ' is-on' : ''}`} onClick=${() => { if (c.id !== 'search') choose(c.id); }}>
          <span class="settings-nav__index num" aria-hidden="true">${c.id === 'search' ? matched.size : String(i + (searching ? 0 : 1)).padStart(2, '0')}</span>
          <span>${tc('settings-category', c.label)}<${MicroLabel}>${c.micro}<//></span>
        </button>`)}
      </nav>
      <div ref=${content} class="settings-content" id=${panelId} role="tabpanel" aria-labelledby=${tabId(activeTab)} tabIndex="0">
        <p class="settings-search__status" role="status" aria-live="polite" aria-atomic="true">${searching
          ? matched.size ? t('找到 {n} 项设置', { n: matched.size }) : t('没有找到匹配的设置，请尝试其它关键词。') : ''}</p>
        ${categories.map(c => html`<section key=${c.id} class="settings-category set-list" data-settings-category=${c.id}
          hidden=${searching ? !entries.some(entry => entry.category === c.id && matched.has(entry.id)) : category !== c.id}>
          ${searching ? html`<h3 class="settings-category__title">${tc('settings-category', c.label)}<${MicroLabel}>${c.micro}<//></h3>` : null}
          ${entries.filter(entry => entry.category === c.id).map(entry => html`<div key=${entry.id} class="settings-entry set-list"
            data-setting-id=${entry.id} hidden=${!show(entry)}>${entry.render(show(entry))}</div>`)}
        </section>`)}
      </div>
    </div>
  </div>`;
}
