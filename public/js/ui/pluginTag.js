// ui/pluginTag.js — the room's plugin tag and the small facts the screens show of plugins (DESIGN §32 P1a): kept apart
// from the 插件 panel (ui/pluginPanel.js), which loads only when it opens, so the title page and the room carry just this.
//
//   * PluginTag — the tag at the top of the room (screens/room.js): 「原版」, or 「插件 ×N」 once its host switched plugins
//     on — marked unofficial (「非官方」) when they change gameplay (a content set of its own, DESIGN §32.6); a tap loads
//     the panel (ui/pluginPanel.js PluginPanel) and opens it.
//   * roomPluginFacts — what the room's plugins are for this player; pluginTagText, sizeText, pluginMicro — their words.
//   * UnofficialMark — the small 「非官方」 / MOD mark of a match with gameplay plugins (the briefing, the HUD corner, the
//     result; DESIGN §32.6, the design study's §7.4); nothing for the original game (cosmetic plugins only included).
//   * VersionTag — the name of the official version a room or a record plays when it is not 第二期下半 (DESIGN §35.23:
//     the room's top bar beside the mode, the briefing, the settlement and the result beside UnofficialMark, a 统计数据
//     row [ASSUMED placement]); nothing for 第二期下半. Not unofficial: an official version is the original game.
// Texts go through t() (docs/I18N.md).

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { createStore, useStore } from '../store.js';
import { installedCount, lobbyPreview } from '../content.js';
import { t } from '../../../shared/i18n.js';
import { rulePhrases } from '../../../shared/plugins/rules.js';
import { DEFAULT_VERSION, versionById } from '../../../shared/versions.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** A size in KB / MB. @param {number} n */
export const sizeText = (n) => (!Number.isFinite(n) ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * What the room's plugins are for this player: `count` (0 = the original art), the ids switched on and those switched on
 * automatically, whether this player may change them (the host, outside a match), the room's warnings.
 * @param {any} room room.state payload
 * @param {any} myId
 */
export function roomPluginFacts(room, myId) {
  const list = Array.isArray(room?.content?.plugins) ? room.content.plugins.filter((p) => p && typeof p.id === 'string') : [];
  const c = room?.content;
  return {
    count: list.length,
    plugins: list,
    on: new Set(list.map((p) => p.id)),
    auto: new Set(list.filter((p) => p.auto).map((p) => p.id)),
    chosen: list.filter((p) => !p.auto).map((p) => p.id),
    editable: room?.hostId != null && room.hostId === myId && !room.inMatch,
    inMatch: !!room?.inMatch,
    warnings: Array.isArray(c?.warnings) ? c.warnings.filter((w) => w && typeof w.code === 'string') : [],
    vs: typeof c?.vs === 'string' ? c.vs : null,
    // gameplay plugins (DESIGN §32.6): the room plays a content set of its own — unofficial
    modded: !!c && c.vanilla === false,
    cs: typeof c?.cs === 'string' ? c.cs : null,
    modes: Array.isArray(c?.modes) ? c.modes.filter((m) => m && typeof m.id === 'string') : [],
    modeId: typeof c?.modeId === 'string' ? c.modeId : null,
    dataBytes: Number.isFinite(c?.dataBytes) ? c.dataBytes : 0,
    rules: c?.rules && typeof c.rules === 'object' && !Array.isArray(c.rules) ? c.rules : null,
  };
}

/**
 * The active non-default rules in words, or '' when the room plays the official options.
 * @param {Record<string, string>|null|undefined} rules
 */
export function ruleLine(rules) {
  const phrases = rulePhrases(rules);
  if (!phrases.length) return '';
  return t('规则：{text}', { text: phrases.map((p) => t(p)).join('；') });
}

/** Does the room play gameplay plugins (a content set of its own: unofficial — DESIGN §32.6)? @param {any} room */
export const isModdedRoom = (room) => !!room?.content && room.content.vanilla === false;

/**
 * The small unofficial mark of a match with gameplay plugins (see the header): 「非官方」 (or the HUD's MOD), nothing for
 * the original game. @param {{ room: any, compact?: boolean, class?: string }} props
 */
export function UnofficialMark({ room, compact = false, class: cls = '' }) {
  if (!isModdedRoom(room)) return null;
  // the gameplay plugins only (a cosmetic one beside them changes no battle)
  const n = roomPluginFacts(room, null).plugins.filter((p) => p.class === 'content').length;
  const tip = t('非官方：本局使用了改变玩法的插件（{n} 个），不计入统计总览', { n });
  return html`<span class=${cx('modmark', compact && 'modmark--compact', cls)} title=${tip} aria-label=${tip} data-testid="unofficial-mark">
    ${compact ? 'MOD' : t('非官方')}
  </span>`;
}

/** What the tag says: 「插件 ×N」 or 「原版」. @param {any} room */
export const pluginTagText = (room) => {
  const f = roomPluginFacts(room, null);
  return [f.count ? t('插件 ×{n}', { n: f.count }) : t('原版'), ruleLine(f.rules)].filter(Boolean).join(' · ');
};

/** A label for a catalogue entry's micro line in 设置 (ui/settings.js). @param {any} p */
export const pluginMicro = (p) => [p?.id, p?.version ? `v${p.version}` : null, Number.isFinite(p?.artBytes) ? sizeText(p.artBytes) : null].filter(Boolean).join(' · ');

/** The tag at the top of the room: 「原版」 or 「插件 ×N」; a tap loads the panel and opens it. */
export function PluginTag({ room, myId }) {
  // the panel's component once loaded (a function in state: set through an updater)
  const [Panel, setPanel] = useState(null);
  const f = roomPluginFacts(room, myId);
  const rulesText = ruleLine(f.rules);
  const open = () => {
    import('./pluginPanel.js').then((m) => setPanel(() => m.PluginPanel), (err) => console.warn('[plugins] the panel did not load', err));
  };
  return html`<button type="button" class=${cx('plugtag', f.count && 'is-modded', f.modded && 'is-unofficial', rulesText && 'plugtag--rules')} data-testid="plugin-tag" onClick=${open}
      title=${f.modded ? t('本房间使用了改变玩法的插件（非官方）') : t('插件')} aria-label=${pluginTagText(room)}>
    <${Icon} name=${f.count ? 'edit' : 'check'} />${f.count ? t('插件 ×{n}', { n: f.count }) : t('原版')}${f.modded ? html`<b class="plugtag__mod">${t('非官方')}</b>` : null}${rulesText ? html`<span class="plugtag__rules" data-testid="plugin-rules">${rulesText}</span>` : null}
  </button>
  ${Panel ? html`<${Panel} open=${true} room=${room} myId=${myId} onClose=${() => setPanel(null)} />` : null}`;
}

/**
 * What the lobby's previewed plugins are for this browser (content.js `lobbyPreview`), in the same shape as
 * `roomPluginFacts` so the shared 插件 panel can render and edit both.
 * @param {any} preview @param {number} [installed]
 */
export function lobbyPluginFacts(preview, installed = 0) {
  const c = preview?.content;
  const list = Array.isArray(c?.plugins) ? c.plugins.filter((p) => p && typeof p.id === 'string') : [];
  const policyRooms = preview?.policy?.rooms || 'host';
  return {
    count: list.length,
    plugins: list,
    on: new Set(list.map((p) => p.id)),
    auto: new Set(list.filter((p) => p.auto).map((p) => p.id)),
    chosen: list.filter((p) => !p.auto).map((p) => p.id),
    editable: installed > 0 && policyRooms === 'host',
    policyRooms,
    inMatch: false,
    warnings: Array.isArray(c?.warnings) ? c.warnings.filter((w) => w && typeof w.code === 'string') : [],
    vs: typeof c?.vs === 'string' ? c.vs : null,
    modded: !!c && c.vanilla === false,
    cs: typeof c?.cs === 'string' ? c.cs : null,
    modes: Array.isArray(c?.modes) ? c.modes.filter((m) => m && typeof m.id === 'string') : [],
    modeId: null,
    dataBytes: Number.isFinite(c?.dataBytes) ? c.dataBytes : 0,
    rules: c?.rules && typeof c.rules === 'object' && !Array.isArray(c.rules) ? c.rules : null,
    status: preview?.status || 'idle',
    error: preview?.error || null,
  };
}

/** Store for the shared lobby plugin panel modal so content reloads inside 自选编队 never close it. */
export const lobbyPluginModal = createStore({ open: false, onOpenDiy: null });
export const openLobbyPlugins = (onOpenDiy = null) => lobbyPluginModal.set({ open: true, onOpenDiy });
export const closeLobbyPlugins = () => lobbyPluginModal.set({ open: false, onOpenDiy: null });

/** Mounted once at root (main.js): lazy-loads and renders LobbyPluginPanel above overlays. */
export function LobbyPluginHost() {
  const st = useStore((s) => s, Object.is, lobbyPluginModal);
  const inRoom = useStore((s) => !!s.room);
  const [Panel, setPanel] = useState(null);
  useEffect(() => {
    if (st.open && !Panel) {
      import('./pluginPanel.js').then((m) => setPanel(() => m.LobbyPluginPanel), (err) => console.warn('[plugins] the panel did not load', err));
    }
  }, [st.open, Panel]);
  useEffect(() => { if (inRoom && st.open) closeLobbyPlugins(); }, [inRoom, st.open]);
  if (!st.open || inRoom || !Panel) return null;
  return html`<${Panel} open=${true} onOpenDiy=${st.onOpenDiy} onClose=${closeLobbyPlugins} />`;
}

/**
 * The lobby's plugin tag (screens/lobby.js, screens/diy.js): lets the player switch room plugins before creating a
 * room so plugin operators can be configured in 大厅 → 干员调配 → 自选编队 and carried into the created room.
 * @param {{ class?: string, testId?: string, onOpenDiy?: (() => void) | false | null }} [props]
 */
export function LobbyPluginTag({ class: cls = '', testId = 'lobby-plugin-tag', onOpenDiy = null } = {}) {
  const installed = useStore(installedCount);
  const preview = useStore((s) => s, Object.is, lobbyPreview);
  if (!installed) return null;
  const f = lobbyPluginFacts(preview, installed);
  const rulesText = ruleLine(f.rules);
  const label = f.count ? t('插件 ×{n}', { n: f.count }) : t('原版');
  const aria = [label, rulesText].filter(Boolean).join(' · ');
  return html`<button type="button" class=${cx('plugtag', f.count && 'is-modded', f.modded && 'is-unofficial', rulesText && 'plugtag--rules', cls)} data-testid=${testId} onClick=${() => openLobbyPlugins(onOpenDiy)}
      title=${f.modded ? t('大厅已启用改变玩法的插件（非官方），创建房间时将自动带入') : t('大厅插件')} aria-label=${aria}>
    <${Icon} name=${f.count ? 'edit' : 'check'} />${label}${f.modded ? html`<b class="plugtag__mod">${t('非官方')}</b>` : null}${rulesText ? html`<span class="plugtag__rules" data-testid="lobby-plugin-rules">${rulesText}</span>` : null}
  </button>`;
}

/**
 * The official version's tag (see the header): its name, nothing for 第二期下半 or an unknown id.
 * @param {{ version?: string|null, room?: any, compact?: boolean, class?: string }} props `room` reads room.state.version
 */
export function VersionTag({ version = null, room = null, compact = false, class: cls = '' }) {
  const id = version ?? room?.version ?? null;
  const v = typeof id === 'string' && id !== DEFAULT_VERSION ? versionById(id) : null;
  if (!v) return null;
  const name = t(v.label);
  return html`<span class=${cx('vertag', compact && 'vertag--compact', cls)} data-testid="version-tag" data-version=${v.id}
      title=${t('游戏版本：{name}', { name })} aria-label=${t('游戏版本：{name}', { name })}><span class="vertag__label">${name}</span></span>`;
}
