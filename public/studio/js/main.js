// public/studio/js/main.js — the plugin studio 插件工作台 (DESIGN §32.9, docs/PLUGINS.md §15, docs/PLUGIN-GUIDE.md): the page
// at /studio/ of a running server (this machine and the local network only: server/studio/gate.js). Someone who does
// not write code makes a cosmetic plugin here — 新建插件 from a template and a target found by its official name, files
// dropped on their places, the plugin's findings in plain words beside them with one-click fixes, a live preview drawn by
// the game's own renderer and interface with the original beside it, 打包 for the lock and a zip — while an author who
// does write code edits plugin.json or the files with their own tools: the page follows every change on disk (server-sent
// events, server/studio/watch.js), and so do the rooms of the game the author hosts or plays alone (hot reload).
//
// Structure: this module (the shell: plugin list, the selected plugin, its tabs and sections), ./api.js (the API),
// ./create.js (新建插件), ./catalog.js (从目录安装), ./remove.js (删除所选: the plugins checked in the list), ./picker.js
// (targets), ./slots.js (a slot), ./issues.js (findings), ./info.js (信息 / 文件 /
// 清单), ./editors/ (one module per template — what a section shows), ./preview/ (layers.js: the art the preview
// draws; field.js: the battlefield; cards.js: the interface; sound.js: the sounds). Strings go through t() (the
// language packs); the findings' explanations come from the error catalogue (shared/plugins/errors.js) in Chinese or
// English.

import { render } from '../../vendor/preact.module.js';
import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, UiHosts, alertDialog, confirmDialog } from '../../js/ui/components.js';
import { initLang, useLang, LangToggle } from '../../js/ui/lang.js';
import { data } from '../../js/data.js';
import { createAssets } from '../../js/assets.js';
import { t } from '../../../shared/i18n.js';
import { API, get, post, put, call, pluginPath, nameAuthor, keepStudioKey, takeKeyFromAddress } from './api.js';
import { kindLabel, templateTitle, targetName, sizeText } from './labels.js';
import { IssueList, errorText } from './issues.js';
import { Authoring } from './authoring.js';
import { bondId } from './gameplayModel.js';
import { TrialBench } from './trial.js';
import { CreateDialog } from './create.js';
import { CatalogPage } from './catalog.js';
import { SelectTools, confirmRemoval, removePlugins, showRefused } from './remove.js';
import { ForgeDialog } from './forge.js';
import { TargetPicker } from './picker.js';
import { SlotCard } from './slots.js';
import { InfoForm, FileList, ManifestEditor } from './info.js';
import { editorOf } from './editors/index.js';
import { createPreviewLayers } from './preview/layers.js';
import { FieldPreview } from './preview/field.js';
import { CardPreview } from './preview/cards.js';
import { SoundPreview } from './preview/sound.js';

const cx = (...p) => p.filter(Boolean).join(' ');

/** The preview's art: the layers, data.js's view of `assets` through them, the field view's asset store over them. */
const layers = createPreviewLayers();
const previewAssets = createAssets({ cosmetics: layers });
const showLayers = () => data.setView('assets', (m) => layers.apply(m));
layers.subscribe(showLayers);

/** The page's hooks for tests and the curious (window.__studio). */
const hooks = { ready: false, state: null, preview: null, errors: [] };
globalThis.__studio = hooks;

/** A target out of `<kind>:<key>` (the server's index answers it: GET slots). */
async function sectionOf(section) {
  const r = await get(`slots?template=${encodeURIComponent(section.template)}&target=${encodeURIComponent(section.target)}`);
  return { ...section, targetInfo: r.target, slots: r.slots || [] };
}

/** One section of a plugin: what it replaces (a template and a target), its slots, its previews. */
function Section({ section, state, busy, version, onFiles, onRef, onClear, onFix, onRemove }) {
  const editor = editorOf(section.template);
  const target = section.targetInfo;
  const previews = target ? editor.previews?.(target) || [] : [];
  return html`<section class="st-section" data-section=${`${section.template}|${section.target}`}>
    <header class="st-section__head">
      <span class="st-section__icon">${target?.icon ? html`<img src=${target.icon} alt="" />` : null}</span>
      <div class="st-section__titles">
        <h3>${target ? targetName(target) : section.target}</h3>
        <span class="micro">${templateTitle(section.template)} · ${target ? kindLabel(target.kind) : ''}</span>
      </div>
      <button type="button" class="st-link-btn" onClick=${onRemove} disabled=${busy} title=${t('只是不在这里显示；已经替换的素材不变')}>${t('收起')}</button>
    </header>
    <div class="st-section__body">
      <div class="st-section__slots">
        ${section.slots.map((s) => html`<${SlotCard} key=${s.at.join('.')} slot=${s} target=${target} template=${section.template} overlay=${state.overlay}
          issues=${state.check.issues} busy=${busy} onFiles=${onFiles} onRef=${onRef} onClear=${onClear} onFix=${onFix} />`)}
        ${!section.slots.length ? html`<p class="st-note">${t('这个模板不能替换这一类目标。')}</p>` : null}
      </div>
      <div class="st-section__preview">
        ${previews.includes('cards') ? html`<${CardPreview} target=${target} version=${version} />` : null}
        ${previews.includes('field') ? html`<${FieldPreview} target=${target} assets=${previewAssets} version=${version} />` : null}
        ${previews.includes('sound') ? html`<${SoundPreview} target=${target} slots=${section.slots} version=${version} />` : null}
      </div>
    </div>
  </section>`;
}

/** 添加替换内容: another template and target in the same plugin (an operator's avatar, model and voice in one). */
function AddSection({ open, templates, onClose, onAdd }) {
  const [tpl, setTpl] = useState(null);
  useEffect(() => { if (open) setTpl(null); }, [open]);
  return html`<${Modal} open=${open} title=${t('添加替换内容')} onClose=${onClose} width="9rem" actions=${html`<${Button} onClick=${onClose}>${t('取消')}<//>`}>
    ${!tpl ? html`<div class="st-templates">${templates.map((x) => html`<button type="button" key=${x.id} class="st-template" data-template=${x.id} onClick=${() => setTpl(x)}>
      <strong>${templateTitle(x.id)}</strong><small>${x.kinds.map(kindLabel).join(' · ')}</small></button>`)}</div>`
    : html`<${TargetPicker} kinds=${tpl.kinds} autoFocus=${true} onPick=${(tg) => onAdd({ template: tpl.id, target: `${tg.kind}:${tg.key}` })} />`}
  <//>`;
}

/** The selected plugin. `onGone`: its folder left plugins/ (删除所选, or moved away by hand) — the page lets it go. */
function PluginView({ id, info, onListChanged, eventsAt, onGone }) {
  const [state, setState] = useState(null);
  const [sections, setSections] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('content');
  const [version, setVersion] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [packed, setPacked] = useState(null);
  const [draft, setDraft] = useState(null);
  const [previewIssues, setPreviewIssues] = useState([]);
  const req = useRef(0);

  /** Take a plugin state: its sections' slots, its preview. */
  const adopt = async (st) => {
    const n = ++req.current;
    setState(st);
    hooks.state = st;
    const secs = await Promise.all((st.sections || []).map((s) => sectionOf(s).catch(() => ({ ...s, targetInfo: null, slots: [] }))));
    if (n !== req.current) return;
    setSections(secs);
    const pv = await get(pluginPath(id, 'preview')).catch(() => ({ ops: [], issues: [] }));
    if (n !== req.current) return;
    hooks.preview = pv;
    setPreviewIssues(pv.issues || []);
    layers.set(pv.ops || [], [...secs.map((s) => s.targetInfo),
      ...(st.authoring?.template === 'skins' ? [{ kind: 'operator', key: (st.authoring.target || 'operator:char_102_texas').replace(/^operator:/, ''), container: ['chars'] }] : []),
      ...(st.authoring?.template === 'bond' ? [{ kind: 'bond', key: bondId(st.id), container: ['bonds'] }] : [])]);
    setVersion((v) => v + 1);
  };
  /** Read the plugin again. `fromDisk`: a change on disk asked for it — a folder gone from plugins/ is let go, not an error. */
  const reload = (fromDisk = false) => {
    const n = req.current;
    return get(pluginPath(id)).then(adopt).catch((e) => {
      if (n !== req.current) return; // the view moved on meanwhile (closed, or a newer state shown)
      if (fromDisk === true && e?.code === 'PLUGIN_UNKNOWN') { onGone?.(id); return; }
      alertDialog({ title: t('读取插件失败'), text: errorText(e) });
    });
  };
  useEffect(() => { setState(null); setSections([]); setPacked(null); setTab('content'); reload(); return () => { req.current++; }; }, [id]);
  // a change on disk (the studio's own or the author's tools): read it again
  useEffect(() => { if (eventsAt && eventsAt.ids.includes(id)) reload(true); }, [eventsAt]);

  /** Run a change; its answer is the plugin's new state. */
  const run = async (fn, { list = false } = {}) => {
    setBusy(true);
    try {
      const st = await fn();
      if (st && st.id) await adopt(st);
      if (list) onListChanged();
      return st;
    } catch (e) {
      hooks.errors.push(e?.code || String(e));
      await alertDialog({ title: t('没有成功'), text: errorText(e) });
      return null;
    } finally { setBusy(false); }
  };
  const onFiles = (slot, files) => run(() => post(pluginPath(id, 'slot'), { at: slot.at, files }), { list: true });
  const onRef = (slot, key) => run(() => post(pluginPath(id, 'ref'), { at: slot.at, ref: key }), { list: true });
  const onClear = (slot) => run(() => post(pluginPath(id, 'clear'), { at: slot.at }), { list: true });
  const onFix = (issue) => run(() => post(pluginPath(id, 'fix'), { code: issue.code, at: issue.at, file: issue.file, params: issue.params }), { list: true });
  const saveSections = (list) => run(() => post(pluginPath(id, 'sections'), { sections: list.map((s) => ({ template: s.template, target: s.target })) }));
  const pack = async () => {
    const st = await run(() => post(pluginPath(id, 'pack')), { list: true });
    if (!st) return;
    const ok = st.pack?.wrote && st.check?.ok;
    setPacked({ ok, issues: st.pack?.issues || [] });
    if (ok) {
      const a = document.createElement('a');
      a.href = `${API}${pluginPath(id, 'zip')}`;
      a.download = `${id}-${st.version || '0.0.0'}.zip`;
      document.body.append(a);
      a.click();
      a.remove();
    }
  };
  if (!state) return html`<div class="st-main__empty">${t('正在读取…')}</div>`;
  const name = state.names?.zh || state.names?.en || Object.values(state.names || {})[0] || id;
  const problems = state.check.problems;
  const generalIssues = state.check.issues.filter((i) => !(Array.isArray(i.at) && i.at[0] === 'assets' && sections.some((s) => s.slots.some((sl) => sl.at.every((k, n) => i.at[n + 1] === k)))));
  const tabs = [['content', t('内容')], ['info', t('信息')], ['files', t('文件')], ['manifest', t('清单')], ...(state.class !== 'ui' ? [['trial', t('试一场')]] : [])];
  return html`<div class="st-plugin" data-plugin=${id}>
    <header class="st-plugin__head">
      <div class="st-plugin__titles">
        <h2>${name}</h2>
        <span class="micro"><code>plugins/${id}/</code> · v${state.version || '?'} · ${state.class || '?'} · ${sizeText(state.bytes)}</span>
      </div>
      <span class=${cx('st-badge', state.loaded ? 'is-ok' : 'is-bad')} data-testid="plugin-status">
        ${state.loaded ? t('已载入：可以在游戏里开启') : t('没有载入：有 {n} 个问题', { n: problems })}</span>
      <div class="st-plugin__actions">
        <${Button} onClick=${reload} disabled=${busy}>${t('重新检查')}<//>
        <${Button} variant="primary" onClick=${pack} loading=${busy} data-testid="pack">${t('打包并下载')}<//>
      </div>
    </header>
    ${packed ? html`<div class=${cx('st-banner', packed.ok ? 'is-ok' : 'is-bad')} data-testid="pack-result">
      ${packed.ok ? t('打包完成：已写入 plugin.lock.json，zip 已开始下载。') : t('还不能打包：先解决下面的问题。')}
      <${IssueList} issues=${packed.issues} onFix=${onFix} busy=${busy} compact=${true} />
    </div>` : null}
    <nav class="st-tabs" role="tablist">${tabs.map(([k, label]) => html`<button type="button" key=${k} role="tab" aria-selected=${tab === k ? 'true' : 'false'}
      class=${cx('st-tab', tab === k && 'is-on')} onClick=${() => setTab(k)} data-tab=${k}>${label}</button>`)}</nav>
    ${tab === 'content' ? html`<div class="st-content">
      ${generalIssues.length ? html`<div class="st-banner is-bad"><strong>${t('整体检查')}</strong><${IssueList} issues=${generalIssues} onFix=${onFix} busy=${busy} /></div>` : null}
      ${previewIssues.length ? html`<div class="st-banner is-warn"><strong>${t('预览')}</strong><${IssueList} issues=${previewIssues} onFix=${onFix} busy=${busy} compact=${true} /></div>` : null}
      ${state.authoring ? html`<${Authoring} slotActions=${{ onFiles, onRef, onClear, onFix }} key=${id} state=${state} busy=${busy} initialDraft=${draft} onDraft=${setDraft}
        onSave=${draft => run(() => post(pluginPath(id, 'authoring'), draft), { list: true })} />` : null}
      ${sections.map((s, n) => html`<${Section} key=${`${s.template}|${s.target}`} section=${s} state=${state} busy=${busy} version=${version}
        onFiles=${onFiles} onRef=${onRef} onClear=${onClear} onFix=${onFix} onRemove=${() => saveSections(sections.filter((_, k) => k !== n))} />`)}
      ${state.class === 'cosmetic' && !state.authoring && !(state.sections || []).length ? html`<p class="st-note">${t('这个插件还没有要替换的内容。')}</p>` : null}
      ${state.class === 'cosmetic' ? html`<${Button} icon="plus" onClick=${() => setAddOpen(true)} disabled=${busy} data-testid="add-section">${t('添加替换内容')}<//>` : null}
      <${AddSection} open=${addOpen} templates=${info.templates.filter(x => x.class === 'cosmetic' && !['theme', 'notices', 'skins'].includes(x.id))} onClose=${() => setAddOpen(false)}
        onAdd=${(s) => { setAddOpen(false); if (!sections.some((x) => x.template === s.template && x.target === s.target)) saveSections([...sections, s]); }} />
    </div>` : null}
    ${tab === 'trial' ? html`<${TrialBench} state=${state} draft=${draft} />` : null}
    ${tab === 'info' ? html`<${InfoForm} state=${state} busy=${busy} onFix=${onFix} onSave=${(fields, lang) => run(() => post(pluginPath(id, 'meta'), { fields, lang }), { list: true })} />` : null}
    ${tab === 'files' ? html`<${FileList} state=${state} busy=${busy} onFix=${onFix} onRemove=${async (rel) => {
      if (await confirmDialog({ title: t('删除文件'), text: t('从插件文件夹里删除 {file}？', { file: rel }), okText: t('删除'), danger: true })) run(() => call('DELETE', pluginPath(id, `files/${rel.split('/').map(encodeURIComponent).join('/')}`)), { list: true });
    }} />` : null}
    ${tab === 'manifest' ? html`<${ManifestEditor} state=${state} busy=${busy} onSave=${(text) => run(() => put(pluginPath(id, 'manifest'), new Blob([text], { type: 'application/json' })), { list: true })} />` : null}
  </div>`;
}

/**
 * The studio without its key (server/studio/key.js): it shows the plugins, a change is refused — the address with the key
 * is in the server's window (the boot banner's "Studio" line); pasting it here keeps it in this browser.
 */
function KeyBar({ state, onKey }) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBad(!(await onKey(text)));
  };
  return html`<form class="st-keybar" data-testid="key-bar" onSubmit=${submit}>
    <strong>${t('只能查看')}</strong>
    <span>${t('要新建或修改插件，请打开服务器窗口里「Studio」那一行的地址（它带着工作台钥匙），或把那个地址粘贴到这里：')}</span>
    <input class=${cx('st-input', (bad || state === 'wrong') && 'is-bad')} value=${text} onInput=${(e) => setText(e.currentTarget.value)}
      placeholder=${t('粘贴工作台地址或钥匙')} data-testid="key-input" />
    <${Button} type="submit" variant="primary" size="sm">${t('使用')}<//>
    ${bad || state === 'wrong' ? html`<span class="st-keybar__bad">${t('钥匙不对：请重新复制服务器窗口里的地址。')}</span>` : null}
  </form>`;
}

/** The page. */
function App({ info }) {
  useLang();
  const [keyState, setKeyState] = useState(info.key || 'missing');
  // a change refused for the key (api.js): ask for it again
  useEffect(() => {
    const onKey = (e) => setKeyState(e.detail || 'wrong');
    globalThis.addEventListener('studio-key', onKey);
    return () => globalThis.removeEventListener('studio-key', onKey);
  }, []);
  const useKey = async (text) => {
    if (!keepStudioKey(text)) return false;
    const r = await get('info').catch(() => null);
    setKeyState(r?.key || 'wrong');
    if (r?.key !== 'ok') return false;
    if (r.watching) setEvents((e) => ({ ...e, on: true }));
    refresh();
    nameAuthor();
    return true;
  };
  const [plugins, setPlugins] = useState([]);
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('plugin') || null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pane, setPane] = useState('plugins');
  const [forgeOpen, setForgeOpen] = useState(false);
  const [events, setEvents] = useState({ on: false, at: null });
  const refresh = () => get('plugins').then((r) => setPlugins(r.plugins || [])).catch(() => {});
  useEffect(() => { refresh(); }, []);
  // 删除所选 (./remove.js): the plugins checked in the list — every listed folder but a symbolic link (never moved)
  const [checked, setChecked] = useState(() => new Set());
  const [removing, setRemoving] = useState(false);
  /** What the last removal did: { removed, refused } counts (the note above the list), null before one or after a change. */
  const [removal, setRemoval] = useState(null);
  const removalRef = useRef(null);
  const removable = useMemo(() => plugins.filter((p) => !p.linked), [plugins]);
  // a refreshed list drops the checks of plugins no longer in it
  useEffect(() => {
    setChecked((c) => {
      const listed = new Set(removable.map((p) => p.id));
      const next = new Set([...c].filter((x) => listed.has(x)));
      return next.size === c.size ? c : next;
    });
  }, [removable]);
  const check = (id, on) => {
    setRemoval(null);
    setChecked((c) => { const next = new Set(c); if (on) next.add(id); else next.delete(id); return next; });
  };
  const removeChecked = async () => {
    const chosen = removable.filter((p) => checked.has(p.id));
    if (!chosen.length || removing || !(await confirmRemoval(chosen))) return;
    setRemoving(true);
    setRemoval(null);
    // the plugin open on the right closes first when it is one of them (its view never reads a folder that left)
    if (chosen.some((p) => p.id === selected)) setSelected(null);
    let r = null;
    try { r = await removePlugins(chosen.map((p) => p.id), info.limits?.removeMax); } catch (e) {
      hooks.errors.push(e?.code || String(e));
      await alertDialog({ title: t('没有成功'), text: errorText(e) });
    }
    const gone = new Set((r?.removed || []).map((x) => x.id));
    setChecked((c) => new Set([...c].filter((x) => !gone.has(x))));
    setSelected((s) => (s && gone.has(s) ? null : s));
    await refresh();
    setRemoving(false);
    if (!r) return;
    setRemoval({ removed: gone.size, refused: r.refused.length });
    if (r.refused.length) await showRefused(r.refused, chosen, gone.size);
    // keyboard focus on what happened (the button that started it may be disabled now)
    setTimeout(() => removalRef.current?.focus(), 0);
  };
  // hot reload: the server's events (a plugin changed on disk)
  // (closed while the page is hidden in the browser's back / forward cache: an open stream holds one of the few
  // connections a browser keeps to a server, and a few kept pages would stall every request of the page shown)
  useEffect(() => {
    let es = null;
    const open = () => {
      if (es) return;
      try {
        es = new EventSource(`${API}events`);
        // on: the server watches plugins/ (it starts with the first call that carries the key)
        es.addEventListener('hello', (ev) => {
          let watching = true;
          try { watching = JSON.parse(ev.data).watching !== false; } catch { /* an older server */ }
          setEvents((e) => ({ ...e, on: watching }));
        });
        es.addEventListener('change', (ev) => {
          let ids;
          try { ids = JSON.parse(ev.data).ids || []; } catch { ids = []; }
          setEvents({ on: true, at: { ids, n: Date.now() } });
          refresh();
        });
        es.onerror = () => setEvents((e) => ({ ...e, on: false }));
      } catch { /* no events: the page still works, without hot reload */ }
    };
    const close = () => { es?.close(); es = null; };
    const onShow = (e) => { if (e.persisted) { open(); refresh(); } };
    open();
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', onShow);
    return () => { close(); window.removeEventListener('pagehide', close); window.removeEventListener('pageshow', onShow); };
  }, []);
  // the author's game sessions: rooms they host apply a plugin's changes by themselves
  useEffect(() => {
    nameAuthor();
    const timer = setInterval(nameAuthor, 60000);
    const onFocus = () => nameAuthor();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);
  useEffect(() => {
    const u = new URL(location.href);
    if (selected) u.searchParams.set('plugin', selected); else u.searchParams.delete('plugin');
    history.replaceState(null, '', u);
  }, [selected]);
  const list = useMemo(() => plugins, [plugins]);
  return html`<div class="st-app">
    <header class="st-top">
      <div class="st-top__brand"><span class="micro micro--mint">PLUGIN STUDIO</span><h1>${t('插件工作台')}</h1></div>
      <span class=${cx('st-live', events.on && 'is-on')} title=${t('插件文件一改，这里和游戏里几秒内就会跟着变')}>${events.on ? t('热重载：开') : t('热重载：未连接')}</span>
      <a class="st-top__link" href="/studio/console.html" data-testid="console-open">${t('测试控制台')}</a>
      <a class="st-top__link" href="/" target="_blank" rel="noopener">${t('打开游戏')}</a>
      <a class="st-top__link" href="https://github.com/sganggs/Stronghold-Protocol/blob/master/docs/PLUGIN-GUIDE.md" target="_blank" rel="noopener">${t('新手指南')}</a>
      <${LangToggle} class="st-top__lang" />
    </header>
    ${keyState !== 'ok' ? html`<${KeyBar} state=${keyState} onKey=${useKey} />` : null}
    <div class="st-body">
      <aside class="st-side">
        <${Button} variant="primary" block=${true} onClick=${() => setCreateOpen(true)} data-testid="new-plugin">${t('新建插件')}<//>
        <${Button} block=${true} active=${pane === 'catalog'} onClick=${() => setPane('catalog')} data-testid="catalog-open">${t('从目录安装')}<//>
        <${Button} block=${true} class="st-forge-open" onClick=${() => setForgeOpen(true)} data-testid="forge-import">${t('从 Forge 包导入')}<//>
        ${removable.length ? html`<${SelectTools} count=${checked.size} total=${removable.length} busy=${removing} onRemove=${removeChecked}
          onAll=${(on) => { setRemoval(null); setChecked(on ? new Set(removable.map((p) => p.id)) : new Set()); }}
          onClear=${() => { setRemoval(null); setChecked(new Set()); }} />` : null}
        ${removal ? html`<div ref=${removalRef} tabindex="-1" role="status" data-testid="remove-result"
            class=${cx('st-banner', 'st-side__result', removal.refused ? (removal.removed ? 'is-warn' : 'is-bad') : 'is-ok')}>
          ${removal.removed ? html`<div>${t('已移到 plugins/_removed/：{n} 个插件', { n: removal.removed })}</div>` : null}
          ${removal.refused ? html`<div>${t('{n} 个插件没有删除', { n: removal.refused })}</div>` : null}
        </div>` : null}
        <ul class="st-list" data-testid="plugin-list">
          ${list.map((p) => html`<li key=${p.id} class="st-list__row">
            <input type="checkbox" class="st-list__check" checked=${checked.has(p.id)} disabled=${!!p.linked || removing}
              onChange=${(e) => check(p.id, e.currentTarget.checked)} data-testid="plugin-check" data-check=${p.id}
              aria-label=${t('选中「{name}」', { name: p.name || p.id })}
              title=${p.linked ? t('符号链接的插件文件夹不能在这里删除。') : undefined} />
            <button type="button" class=${cx('st-list__item', selected === p.id && 'is-on', (p.status === 'skipped' || p.linked) && 'is-bad')}
              onClick=${() => { setPane('plugins'); setSelected(p.id); }} data-plugin=${p.id} disabled=${!!p.linked}
              title=${p.linked ? t('这个插件文件夹是符号链接：游戏照常读取它，工作台只打开真实的文件夹。') : undefined}>
            <span class="st-list__name">${p.name || p.id}</span>
            <span class="st-list__meta"><code>${p.id}</code>${p.linked ? ` · ${t('符号链接，工作台不打开')}` : ''}${p.version ? ` · v${p.version}` : ''}${p.status === 'skipped' && !p.linked ? ` · ${t('{n} 个问题', { n: p.problems })}` : p.class !== 'cosmetic' && p.class ? ` · ${p.class}` : ''}</span>
          </button></li>`)}
          ${!list.length ? html`<li class="st-note">${t('还没有插件。点「新建插件」开始。')}</li>` : null}
        </ul>
        <p class="st-side__foot">${t('插件放在服务器的 plugins/ 文件夹里；这个页面只有本机和局域网能打开。')}</p>
      </aside>
      <main class="st-main">
        ${pane === 'catalog' ? html`<${CatalogPage} canChange=${keyState === 'ok'} />`
        : selected ? html`<${PluginView} key=${selected} id=${selected} info=${info} onListChanged=${refresh} eventsAt=${events.at}
            onGone=${(gone) => setSelected((s) => (s === gone ? null : s))} />`
        : html`<div class="st-main__empty">
            <h2>${t('做一个插件')}</h2>
            <ol class="st-steps">
              <li>${t('点「新建插件」，选择外观、玩法、DSL、界面或脚本模板。')}</li>
              <li>${t('按官方名字搜索要替换的干员、敌人、道具 ……')}</li>
              <li>${t('把自己的图片、模型或声音拖到格子上，右边和原版并排预览。')}</li>
              <li>${t('点「打包并下载」，得到可以分享的 zip。')}</li>
            </ol>
          </div>`}
      </main>
    </div>
    <${CreateDialog} open=${createOpen} templates=${info.templates} onClose=${() => setCreateOpen(false)}
      onCreated=${(st) => { setCreateOpen(false); setPane('plugins'); refresh(); setSelected(st.id); }} />
    <${ForgeDialog} open=${forgeOpen} onClose=${() => setForgeOpen(false)}
      onImported=${(plugins) => { setForgeOpen(false); refresh(); if (plugins[0]?.id) setSelected(plugins[0].id); }} />
    <${UiHosts} />
  </div>`;
}

async function boot() {
  const root = document.getElementById('app');
  try {
    await initLang().catch(() => {});
    // the address the server printed brings the key (…/studio/#key=…): kept in this browser, taken out of the address bar
    takeKeyFromAddress();
    const [info] = await Promise.all([get('info'), data.loadAll('assets', 'chess', 'tokens', 'enemies', 'items', 'bonds', 'bands', 'backups', 'config', 'stages')]);
    previewAssets.seed(data.getRaw('assets'));
    showLayers();
    render(html`<${App} info=${info} />`, root);
    hooks.ready = true;
  } catch (e) {
    console.error('[studio] the page did not start', e);
    root.textContent = `${t('插件工作台没有启动')}: ${e?.message || e}`;
  }
}

boot();
