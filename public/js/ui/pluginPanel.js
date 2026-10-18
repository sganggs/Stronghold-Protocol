// ui/pluginPanel.js — the room's 插件 panel (DESIGN §32 P1a; the design study's §7.1) and the list of a server's plugins.
// Loaded only when one of them opens (the room's tag, ui/pluginTag.js; the title screen's button, screens/title.js), so
// the title page and the room carry none of it:
//
//   * PluginPanel — the cosmetic and (P1c, DESIGN §32.6) content plugins this server has for rooms (the catalogue:
//     content.js loadCatalog — fetched when the panel opens, and only on a server that has plugins: content.plugins > 0),
//     each with its
//     switch for the host and its state for everybody else (the other players and the spectators read it), its version,
//     authors, size and a 非官方 mark; 「自动」 on one switched on because another needs it; the warnings of the room's set
//     (two plugins change the same art — the later one applies; a plugin made for other game versions, still usable:
//     art never changes a battle). The host's switch sends room.setPlugins with the plugins it wants (the server adds
//     what they require); during a match it is read-only. 「重新应用」 (the host, a room with plugins) sends the same
//     choice again: when a plugin's files changed on the server since (the lobby tells the host: an m.toast), that
//     makes the set of the files as they are now. A content plugin changes the room's gameplay (unofficial: 改变玩法, its
//     match stays out of the statistics overview); one made for other game versions cannot be switched on. With gameplay
//     plugins the panel also shows the room's mode — the official one of the difficulty or a mode a plugin adds
//     (room.setMode; the host picks, the others read it) — and this page's download and check of the room's content set
//     (content.js contentSet: its progress, ready, or failed — 「请刷新页面」). Below them (P4, DESIGN §32.8) the
//     interface plugins of the server — each player switches them in 设置; the host may mark one 推荐 — and the
//     room.panel slot.
//   * InstalledPlugins — the title screen's 「本服务器安装了 N 个插件」 (screens/title.js; §7.4): every unofficial plugin
//     the catalogue lists — any class, with what this version does with it (the catalogue fetched when it opens).
// The tag and the small facts (roomPluginFacts, sizeText, pluginTagText, pluginMicro) are ui/pluginTag.js's, re-exported
// here. Texts go through t() (docs/I18N.md).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { APP_VERSION } from '../../../shared/constants.js';
import { html, Modal, Button, Icon } from './components.js';
import { PluginSettings, settingsSelection } from './pluginSettings.js';
import { toastError } from './toasts.js';
import { net } from '../net.js';
import { useStore } from '../store.js';
import { catalog, contentSet, loadCatalog, cosmeticPlugins, installedCount, pluginName, unofficialPlugins, personal, personalSet } from '../content.js';
import { appVersionMatches } from '../../../shared/plugins/manifest.js';
import { toggleRecommend, uiPluginEntries, uiRecommend, visibleRecommend } from './uiPlugins.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
import { sizeText, roomPluginFacts, pluginTagText, pluginMicro, ruleLine } from './pluginTag.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export { sizeText, roomPluginFacts, pluginTagText, pluginMicro };

/**
 * The ids room.setPlugins sends when the host switches `id` on or off: the plugins the host chose, without the
 * automatic ones (the server adds what the chosen ones require) and without one the server no longer offers (`offered`:
 * the ids of the catalogue's room plugins, once it is loaded — removed, skipped or of another scope now: sending it again
 * would refuse every switch). null while the catalogue is not loaded: the choice is sent as it is.
 * @param {string[]} chosen @param {string} id @param {boolean} on @param {Set<string> | null} [offered]
 * @returns {string[]}
 */
export function nextChoice(chosen, id, on, offered = null) {
  const out = chosen.filter((x) => x !== id && (!offered || offered.has(x)));
  if (on) out.push(id);
  return out;
}

/** The plugins a room may switch on: the loaded cosmetic and content plugins of scope `room` (the catalogue's order). */
export const roomPlugins = (plugins) => [
  ...cosmeticPlugins(plugins, 'room'),
  ...(Array.isArray(plugins) ? plugins : []).filter((p) => p && ['content','script','trusted'].includes(p.class) && p.status === 'loaded' && Array.isArray(p.scope) && p.scope.includes('room')),
].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));

/** [ASSUMED] Installed optional cosmetics are companion looks. A hint never changes a room or personal choice. */
export function companionCosmeticHints(plugin, plugins, active) {
  if (!['content', 'script', 'trusted'].includes(plugin.class)) return [];
  return cosmeticPlugins(plugins, 'personal').filter(p => !active.has(p.id)
    && Object.hasOwn(plugin.optional || {}, p.id) && appVersionMatches(plugin.optional[p.id], p.version))
    .map(p => t('外观在『{name}』（设置 → 外观插件）', { name: pluginName(p) }));
}

/** One warning of the room's set as a sentence (room.state.content.warnings, server/plugins/visualSet.js / roomSets.js). */
function warningText(w, nameOf, classOf = () => 'cosmetic') {
  if (w.code === 'override' && Array.isArray(w.params?.plugins)) {
    const [a, b] = w.params.plugins;
    return t('「{a}」和「{b}」都改了 {path}（后者生效）', { a: nameOf(a), b: nameOf(b), path: String(w.params.path || '') });
  }
  if (w.code === 'app' && classOf(w.params?.id) === 'content') return t('「{name}」适配 {app}，本服务器是 {version}（服主允许使用）', { name: nameOf(w.params?.id), app: String(w.params?.app || ''), version: APP_VERSION });
  if (w.code === 'app') return t('「{name}」适配 {app}，本服务器是 {version}（外观插件，仍可使用）', { name: nameOf(w.params?.id), app: String(w.params?.app || ''), version: APP_VERSION });
  return w.code;
}

/** This page's download and check of the room's content set (content.js contentSet), as one line. */
function ContentState({ cs }) {
  const c = useStore((s) => s, Object.is, contentSet);
  if (!cs || c.cs !== cs) return null;
  if (c.status === 'ready') return html`<p class="set-hint plugpanel__content is-ready" data-testid="content-state">${t('插件内容已载入并通过校验')}</p>`;
  if (c.status === 'failed') return html`<p class="set-hint plugpanel__content is-warn" data-testid="content-state">${t('插件内容未能通过校验，请刷新页面重试')}</p>`;
  const pct = c.total > 0 ? Math.min(100, Math.floor((c.loaded / c.total) * 100)) : 0;
  return html`<p class="set-hint plugpanel__content" data-testid="content-state">${t('正在载入插件内容…{pct}%', { pct })}</p>`;
}

/** The room's mode with gameplay plugins: the official one of the difficulty, or a plugin mode (room.setMode). */
function ModePicker({ room, f, busy, onPick }) {
  const modes = f.modes.filter((m) => m.roomMode === room.mode);
  if (!f.modded || !modes.length) return null;
  const official = `mode_${room.mode === 'solo' ? 'single' : 'multi'}_${String(room.difficulty || 'NORMAL').toLowerCase()}`;
  const options = [{ id: official, name: t('原版模式（按难度）') }, ...modes.map((m) => ({ id: m.id, name: typeof m.name === 'string' ? m.name : m.id }))];
  const current = f.modeId || official;
  return html`<div class="plugpanel__modes" role="radiogroup" aria-label=${t('模式')} data-testid="plugin-modes">
    <span class="plugpanel__modes-label">${t('模式')}</span>
    ${options.map((o) => html`<button key=${o.id} type="button" role="radio" aria-checked=${o.id === current ? 'true' : 'false'}
        class=${cx('dpick__opt', o.id === current && 'is-active')} data-mode=${o.id}
        disabled=${!f.editable || !!busy} onClick=${() => o.id !== current && onPick(o.id)}>${o.name}</button>`)}
    ${f.editable ? null : html`<span class="set-hint">${t('由创建者设置')}</span>`}
  </div>`;
}

/** The room's 插件 panel (see the header). */
export function PluginPanel({ open, room, myId, onClose }) {
  const cat = useStore((s) => s, Object.is, catalog);
  const personalIds = useStore(s => s.ids, Object.is, personal);
  const installed = useStore(installedCount);
  const [busy, setBusy] = useState(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  // the catalogue — again each time the panel opens (a plugin dropped in meanwhile shows), never on a server without any
  useEffect(() => { alive.current = true; if (installed) loadCatalog({ force: true }); return () => { alive.current = false; }; }, [installed]);
  const f = roomPluginFacts(room, myId);
  const activeCosmetics = new Set([...f.on, ...personalSet(personalIds, cosmeticPlugins(cat.plugins, 'personal')).order]);
  const recIds = useStore((s) => s.ids, Object.is, uiRecommend);
  const isHost = !!(room && room.hostId != null && room.hostId === myId);
  const recommended = visibleRecommend(room, isHost, recIds);
  const uiList = installed ? uiPluginEntries(cat.plugins) : [];
  const offered = installed ? roomPlugins(cat.plugins) : [];
  const offeredIds = cat.status === 'ready' ? new Set(offered.map((p) => p.id)) : null;
  // a plugin the room has that the catalogue no longer offers (removed, skipped, another scope now) still shows, by its
  // id: its switch only turns it off
  const rows = [...offered, ...f.plugins.filter((p) => !offered.some((o) => o.id === p.id)).map((p) => ({ id: p.id, version: p.version, missing: true }))];
  const nameOf = (id) => { const p = cat.plugins.find((x) => x.id === id); return p ? pluginName(p) : String(id ?? ''); };
  const classOf = (id) => cat.plugins.find((x) => x.id === id)?.class || f.plugins.find((x) => x.id === id)?.class || 'cosmetic';
  const anyContent = f.modded || offered.some((p) => ['content','script','trusted'].includes(p.class));
  /** room.setPlugins with these ids (one request at a time; `what`: the row — or 'reapply' — that shows it busy). */
  const send = async (ids, what, change = null) => {
    if (inFlight.current || !f.editable) return;
    inFlight.current = true;
    setBusy(what);
    try {
      await net.request('room.setPlugins', { plugins: settingsSelection(ids, f.plugins, change) });
    } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const toggle = (id, on) => send(nextChoice(f.chosen, id, on, offeredIds), id);
  // the room's mode (room.setMode, DESIGN §32.6)
  const pickMode = async (modeId) => {
    if (inFlight.current || !f.editable) return;
    inFlight.current = true;
    setBusy('mode');
    try { await net.request('room.setMode', { modeId }); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };
  // the same choice again (without a plugin the server no longer offers): the set of the files as they are now
  const reapply = () => send(f.chosen.filter((x) => !offeredIds || offeredIds.has(x)), 'reapply');
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('插件')} micro="PLUGINS" width="7.4rem"
      actions=${html`<${Button} variant="primary" icon="check" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="plugpanel" data-testid="plugin-panel">
      <p class="plugpanel__lead">
        <span class=${cx('plugtag plugtag--static', f.count && 'is-modded', f.modded && 'is-unofficial')}>${f.count ? t('插件 ×{n}', { n: f.count }) : t('原版')}</span>
        ${t('房间的外观插件只改变画面和声音，不影响战斗；插件为非官方制作。')}
      </p>
      ${anyContent ? html`<p class="set-hint">${t('改变玩法的插件会改变本房间的数据与规则；这样的对局为非官方对局，不计入统计总览。')}</p>` : null}
      ${ruleLine(f.rules) ? html`<p class="set-hint" data-testid="plugin-rules">${ruleLine(f.rules)}</p>` : null}
      <${ContentState} cs=${f.modded ? f.cs : null} />
      <${ModePicker} room=${room} f=${f} busy=${busy} onPick=${pickMode} />
      ${f.inMatch ? html`<p class="set-hint">${t('模拟进行中，插件不能更改')}</p>`
        : f.editable ? null : html`<p class="set-hint">${t('由创建者设置')}</p>`}
      ${installed && cat.status === 'loading' && !rows.length ? html`<p class="set-hint">${t('正在读取插件列表…')}</p>` : null}
      ${installed && cat.status === 'failed' && !rows.length ? html`<p class="set-hint is-warn">${t('无法读取插件列表')}</p>` : null}
      ${(!installed || cat.status === 'ready') && !rows.length ? html`<p class="set-hint">${t('本服务器没有可在房间中使用的插件')}</p>` : null}
      ${rows.length ? html`<ul class="plugpanel__list">
        ${rows.map((p) => {
          const on = f.on.has(p.id);
          const auto = f.auto.has(p.id);
          const content = ['content','script','trusted'].includes(p.class || classOf(p.id));
          // a gameplay plugin made for other game versions is refused (PLUGIN_INCOMPATIBLE): its switch only turns it off
          const blocked = content && p.compatible === false && !on;
          return html`<li key=${p.id} class=${cx('plugrow', on && 'is-on', content && 'is-content')} data-plugin=${p.id}>
            <button type="button" role="switch" aria-checked=${on ? 'true' : 'false'} class=${cx('set-toggle plugrow__switch', on && 'is-on')}
              disabled=${!f.editable || !!busy || (p.missing && !on) || (auto && on && !p.missing) || blocked} aria-label=${pluginName(p)}
              onClick=${() => toggle(p.id, !on)}><i></i><span>${on ? tc('toggle', '开启') : tc('toggle', '关闭')}</span></button>
            <div class="plugrow__body">
              <div class="plugrow__name"><b>${pluginName(p)}</b>${p.version ? html`<span class="num t-dim">v${p.version}</span>` : null}
                ${auto ? html`<span class="plugrow__badge">${t('自动')}</span>` : null}
                <span class=${cx('plugrow__badge', content && 'is-gameplay')}>${(p.execution || f.plugins.find(x => x.id === p.id)?.execution) === 'sandbox' ? t('脚本（沙箱）') : content ? t('改变玩法') : t('外观')}</span><span class="plugrow__badge is-unofficial">${t('非官方')}</span></div>
              <div class="plugrow__meta t-dim">
                ${Array.isArray(p.authors) && p.authors.length ? html`<span>${t('作者 {names}', { names: p.authors.join(', ') })}</span>` : null}
                ${Number.isFinite(p.artBytes) ? html`<span class="num">${sizeText(p.artBytes)}</span>` : null}
                ${p.missing ? html`<span>${t('本服务器已不再提供')}</span>` : null}
              </div>
              ${on ? companionCosmeticHints(p, cat.plugins, activeCosmetics).map(hint => html`<p class="set-hint" data-testid="companion-cosmetic">${hint}</p>`) : null}
              ${on && p.settings ? html`<${PluginSettings} definitions=${p.settings} values=${f.plugins.find(x => x.id === p.id)?.settings || {}}
                disabled=${!f.editable || !!busy || p.missing} onSave=${settings => send([...new Set([...f.chosen, p.id])], p.id, { id: p.id, settings })} />` : null}
              ${p.compatible === false ? html`<div class="plugrow__warn">${content
                ? t('适配 {app}，本服务器是 {version}（改变玩法的插件不能启用）', { app: p.app || '', version: APP_VERSION })
                : t('适配 {app}，本服务器是 {version}（外观插件，仍可使用）', { app: p.app || '', version: APP_VERSION })}</div>` : null}
            </div>
          </li>`;
        })}
      </ul>` : null}
      ${f.editable && f.count ? html`<div class="plugpanel__reapply">
        <${Button} variant="secondary" size="sm" icon="refresh" data-testid="plugin-reapply" disabled=${!!busy} onClick=${reapply}>${t('重新应用')}<//>
        <span class="set-hint">${t('插件的文件在服务器上更新后，重新应用才会生效。')}</span>
      </div>` : null}
      ${f.warnings.filter((w) => w.code !== 'app' || classOf(w.params?.id) === 'content').length ? html`<ul class="plugpanel__warnings" aria-label=${t('插件提示')}>
        ${f.warnings.filter((w) => w.code !== 'app' || classOf(w.params?.id) === 'content').map((w, i) => html`<li key=${i}><${Icon} name="warn" />${warningText(w, nameOf, classOf)}</li>`)}
      </ul>` : null}
      <p class="set-hint">${t('只影响自己的外观插件在「设置」中开关。')}</p>
      ${uiList.length ? html`<section class="plugpanel__ui" data-testid="ui-recommend">
        <p class="set-hint">${t('界面插件由每位博士在「设置」中自己开关。')}</p>
        <p class="set-hint">${t('推荐显示在房间里，是否开启由你自己决定。')}</p>
        <ul class="plugpanel__list">
          ${uiList.map((p) => {
            const marked = recIds.includes(p.id);
            return html`<li key=${p.id} class="plugrow" data-plugin=${p.id}>
              <div class="plugrow__body">
                <div class="plugrow__name"><b>${pluginName(p)}</b>
                  <span class="plugrow__badge">${t('界面')}</span><span class="plugrow__badge is-unofficial">${t('非官方')}</span>
                  ${recommended.includes(p.id) ? html`<span class="plugrow__badge">${t('房主推荐')}</span>` : null}</div>
                ${isHost ? html`<button type="button" class=${cx('set-toggle', marked && 'is-on')} data-testid="ui-recommend-toggle" aria-pressed=${marked ? 'true' : 'false'}
                  onClick=${() => toggleRecommend(p.id, !marked)}>${t('推荐')}</button>` : null}
              </div>
            </li>`;
          })}
        </ul>
      </section>` : null}
      <div class="ui-slot" data-ui-slot="room.panel" aria-label=${t('界面插件')} dangerouslySetInnerHTML=${{ __html: '' }}></div>
    </div>
  <//>`;
}

/** What a class is called in the list (msgids). */
const CLASS_NAMES = { cosmetic: N_('外观'), content: N_('改变玩法'), script: N_('代码'), trusted: N_('代码'), ui: N_('界面'), lang: N_('语言') };

/** The title screen's list of a server's unofficial plugins (see the header): the catalogue, fetched when it opens. */
export function InstalledPlugins({ open, onClose }) {
  const cat = useStore((s) => s, Object.is, catalog);
  useEffect(() => { loadCatalog({ force: true }); }, []);
  const plugins = unofficialPlugins(cat.plugins);
  return html`<${Modal} open=${open} onClose=${onClose} title=${t('本服务器的插件')} micro="PLUGINS" width="6.8rem"
      actions=${html`<${Button} variant="primary" icon="check" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="plugpanel" data-testid="installed-plugins">
      <p class="plugpanel__lead">${t('插件为非官方制作，不属于原版游戏；原版内容始终是默认。')}</p>
      ${cat.status === 'loading' && !plugins.length ? html`<p class="set-hint">${t('正在读取插件列表…')}</p>` : null}
      ${cat.status === 'failed' && !plugins.length ? html`<p class="set-hint is-warn">${t('无法读取插件列表')}</p>` : null}
      <ul class="plugpanel__list">
        ${plugins.map((p) => html`<li key=${p.id} class="plugrow" data-plugin=${p.id}>
          <div class="plugrow__body">
            <div class="plugrow__name"><b>${pluginName(p)}</b>${p.version ? html`<span class="num t-dim">v${p.version}</span>` : null}
              <span class="plugrow__badge">${p.execution === 'sandbox' ? t('脚本（沙箱）') : t(CLASS_NAMES[p.class] || '插件')}</span><span class="plugrow__badge is-unofficial">${t('非官方')}</span></div>
            <div class="plugrow__meta t-dim">
              <span>${p.status === 'loaded' ? t('可以使用') : t('本版本不支持')}</span>
              ${Array.isArray(p.authors) && p.authors.length ? html`<span>${t('作者 {names}', { names: p.authors.join(', ') })}</span>` : null}
            </div>
          </div>
        </li>`)}
      </ul>
    </div>
  <//>`;
}
