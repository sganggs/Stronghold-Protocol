// ui/versionPicker.js — the official version switch (DESIGN §35.23, M1; versions.js): the lobby's chip and the picker the
// lobby and the room open.
//
//   * VersionSwitch — the chip at the lobby's top right (screens/lobby.js, before 恢复本机对局): only when the server
//     enables other versions (welcome.versions); the version the lobby shows (this browser's choice) and, while the page
//     loads or checks its data, how far it is (载入中 n%) or that it failed (校验失败 · 重试). A server that enables one
//     version only, not 第二期下半, shows it as a plain tag (nothing to choose). A tap opens the picker.
//   * VersionPicker — the project's Modal: one row per version the server enables (its name, the official period it
//     replicates, the badges 当前 / 服务器默认, and 预览 on every version but 第二期下半 with what is still an estimate after
//     M2 [ASSUMED]: bounty draws, some numbers, and six enemies' attack wind-ups. In a language other than Simplified
//     Chinese also that its game texts are in Chinese
//     until they are translated — a version's data carries no translations yet). In the lobby a pick is this browser's
//     choice at once (setLobbyVersion); in a room the host's pick proposes the switch (room.proposeVersion — the seated
//     doctors vote, ui/versionVote.js), everybody else reads it (由创建者发起).
// Texts go through t() (docs/I18N.md). [ASSUMED] The existing book glyph represents an archived event period;
// the room's version controls use the same glyph.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Modal, Spinner } from './components.js';
import { useStore } from '../store.js';
import { contentSet, retryContentSet } from '../content.js';
import { DEFAULT_VERSION, VERSION_PERIODS, lobbyVersion, periodLine, serverDefaultVersion, setLobbyVersion, versionLabel } from '../versions.js';
import { getLang, t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** The result screen's button plate (screens/settle.js SettleButtonArt). CSS fills in when the sprite is absent. */
/**
 * Season identity of a version card. 规程 is the regulation family or the period table's
 * regulation half; every other official period is a 盟约 card. Never a bond id.
 * @param {string | { id?: string, family?: string }} v
 * @returns {'regulation' | 'covenant'}
 */
export function versionSeason(v) {
  const id = v && typeof v === 'object' ? v.id : v;
  if ((v && typeof v === 'object' && v.family) === 'regulation' || VERSION_PERIODS[id]?.half === 'regulation') return 'regulation';
  return 'covenant';
}

/**
 * Scroll the open picker's current card into view. Returns that row, or null.
 * @param {ParentNode | null | undefined} root
 */
export function scrollCurrentCard(root) {
  const row = root?.querySelector?.('.verpick__row.is-on, .verpick__row[aria-selected="true"]') || null;
  row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return row;
}

/** The load state of a version on this page, as the chip shows it ('' when its data is on screen or not needed). */
export function versionLoadText(c, id) {
  if (!c || c.kind !== 'version' || c.version !== id) return '';
  if (c.status === 'loading') return t('载入中 {pct}%', { pct: c.total > 0 ? Math.min(100, Math.floor((c.loaded / c.total) * 100)) : 0 });
  if (c.status === 'failed') return t('校验失败');
  return '';
}

/**
 * The picker (see the header).
 * @param {{ mode: 'lobby'|'room', versions: any[], current: string, serverDefault: string, roomMode?: string|null,
 *   editable?: boolean, busy?: boolean, onPick: (id: string) => void, onClose: () => void, note?: string|null }} props
 */
export function VersionPicker({ mode, versions, current, serverDefault, roomMode = null, editable = true, busy = false, onPick, onClose, note = null }) {
  const list = Array.isArray(versions) ? versions : [];
  const chineseTexts = getLang() !== 'zh';
  const listRef = useRef(null);
  useEffect(() => { scrollCurrentCard(listRef.current); }, [current, list.length]);
  return html`<${Modal} open=${true} onClose=${onClose} class="verpick" micro="OFFICIAL VERSION" title=${t('游戏版本')} width="min(12.6rem, 96vw)"
      actions=${html`<${Button} variant="ghost" class="verpick__close" onClick=${onClose}>${t('关闭')}<//>`}>
    <p class="verpick__lead">${mode === 'room' ? t('同盟的版本由创建者发起切换，在座的博士全部同意后生效。') : t('大厅版本只影响本机：加入其他版本的同盟时会载入该版本，离开后恢复。')}</p>
    <ul ref=${listRef} class="verpick__list" role="listbox" aria-label=${t('游戏版本')} data-testid="version-picker">
      ${list.map((v) => {
        const on = v.id === current;
        const usable = !roomMode || !Array.isArray(v.roomModes) || v.roomModes.includes(roomMode);
        const preview = v.id !== DEFAULT_VERSION;
        const season = versionSeason(v);
        // Colour is the season: red 规程, teal 盟约. (No registry id on the card: it means nothing to a player.)
        return html`<li key=${v.id} role="option" aria-selected=${on ? 'true' : 'false'} data-season=${season}
            class=${cx('verpick__row', season === 'regulation' ? 'is-reg' : 'is-covenant', on && 'is-on', preview && 'is-preview')}>
          <button type="button" class="verpick__pick" data-version=${v.id} data-autofocus=${on ? '' : undefined}
              disabled=${!editable || busy || on || !usable} onClick=${() => onPick(v.id)}>
            <span class="verpick__name">${versionLabel(v.id)}</span>
            <span class="verpick__badges">
              ${on ? html`<span class="verpick__badge is-current">${t('当前')}</span>` : null}
              ${v.id === serverDefault ? html`<span class="verpick__badge">${t('服务器默认')}</span>` : null}
              ${preview ? html`<span class="verpick__badge is-preview">${t('预览')}</span>` : null}
            </span>
            <span class="verpick__period t-lo">${periodLine(v.id)}</span>
            ${preview ? html`<span class="verpick__note t-dim">${t('核心规则已按该版本。悬赏抽取、部分数值和六名敌人的攻击前摇仍是推算')}${chineseTexts ? html`<br />${t('该版本的游戏文本暂时只有中文')}` : null}</span>` : null}
            ${usable ? null : html`<span class="verpick__note is-warn">${t('该版本不支持当前的模拟方式')}</span>`}
          </button>
        </li>`;
      })}
    </ul>
    ${note ? html`<p class="verpick__hint"><${Icon} name="info" />${note}</p>` : null}
    ${busy ? html`<p class="verpick__hint"><${Spinner} size="sm" />${t('正在发起切换…')}</p>` : null}
  <//>`;
}

/** The lobby's chip (see the header). */
export function VersionSwitch() {
  const versions = useStore((s) => s.versions);
  const current = useStore(lobbyVersion);
  const serverDefault = useStore(serverDefaultVersion);
  const c = useStore((s) => s, Object.is, contentSet);
  const [open, setOpen] = useState(false);
  if (!Array.isArray(versions) || !versions.length) return null;
  const load = versionLoadText(c, current);
  const failed = c.kind === 'version' && c.version === current && c.status === 'failed';
  const loading = c.kind === 'version' && c.version === current && c.status === 'loading';
  // one version only (not 第二期下半): what the server plays, nothing to choose
  if (versions.length === 1) {
    return html`<span class="verchip verchip--ro" data-testid="version-switch" data-version=${current} title=${t('本服务器的游戏版本')}>
      <${Icon} name="book" /><span class="verchip__label">${versionLabel(current)}</span>${load ? html`<small class="verchip__state">${load}</small>` : null}
    </span>`;
  }
  return html`<span class="verchip-wrap">
    <button type="button" class=${cx('verchip', current !== DEFAULT_VERSION && 'is-other', failed && 'is-failed')} data-testid="version-switch" data-version=${current}
        aria-busy=${loading ? 'true' : 'false'} onClick=${() => setOpen(true)} title=${t('切换大厅版本（只影响本机）')} aria-haspopup="dialog">
      <${Icon} name="book" /><span class="verchip__k">${t('版本')}</span><span class="verchip__label">${versionLabel(current)}</span>
      ${loading ? html`<${Spinner} size="sm" />` : null}${load ? html`<small class="verchip__state">${load}</small>` : null}
    </button>
    ${failed ? html`<button type="button" class="verchip__retry" data-testid="version-retry" onClick=${retryContentSet}>${t('重试')}</button>` : null}
    ${open ? html`<${VersionPicker} mode="lobby" versions=${versions} current=${current} serverDefault=${serverDefault}
      onPick=${(id) => { setLobbyVersion(id); setOpen(false); }} onClose=${() => setOpen(false)} />` : null}
  </span>`;
}
