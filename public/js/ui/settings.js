// Player settings (BGM/SFX/voice volume, mute, damage numbers, render quality): a tiny observable store
// persisted in localStorage (`sp.pref.settings`), applied to the audio manager on every change, plus
// the settings modal.

import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { sanitizeSettings } from './gameLogic.js';
import { audio } from '../audio.js';
import { openGuide } from './guide.js';
import { detectFeatures } from './device.js';
import { KEY_ACTIONS, bindingCodeForEvent, keyLabel } from './keymap.js';
import { keymapStore, useKeymap, updateKeybinding, resetKeybindings } from './keymapStore.js';

/** Settings store: { bgm, sfx, voice, muted, damageNumbers, quality }. */
export const settingsStore = createStore(sanitizeSettings(loadPref('settings', null)));

settingsStore.subscribe((s) => {
  savePref('settings', sanitizeSettings(s));
  audio.setVolumes(s);
});
audio.setVolumes(settingsStore.get());

/** @param {Partial<ReturnType<typeof sanitizeSettings>>} patch */
export function updateSettings(patch) {
  settingsStore.set(sanitizeSettings({ ...settingsStore.get(), ...patch }));
}

/** Preact hook: current settings. */
export const useSettings = () => useStore((s) => s, Object.is, settingsStore);

function Slider({ label, micro, value, onInput, icon }) {
  const pct = Math.round(value * 100);
  return html`<label class="set-row">
    <span class="set-row__label"><${Icon} name=${icon} />${label}<${MicroLabel}>${micro}<//></span>
    <input class="set-range" type="range" min="0" max="100" step="5" value=${pct} style=${`--pct:${pct}%`}
      onInput=${(e) => onInput(Number(e.currentTarget.value) / 100)} />
    <span class="set-row__val num">${pct}</span>
  </label>`;
}

function Toggle({ label, micro, value, onChange }) {
  return html`<div class="set-row">
    <span class="set-row__label">${label}<${MicroLabel}>${micro}<//></span>
    <button type="button" class=${`set-toggle${value ? ' is-on' : ''}`} role="switch" aria-checked=${value ? 'true' : 'false'}
      onClick=${() => onChange(!value)}><i></i><span>${value ? '开启' : '关闭'}</span></button>
  </div>`;
}

const QUALITY = [['high', '高'], ['medium', '中'], ['low', '低']];

const KEY_ACTION_LABELS = {
  refresh: '刷新商店', freeze: '冻结商店', levelUp: '升级调度中心',
  retreat: '撤退选中干员', sell: '出售选中干员', ready: '准备就绪 / 单人暂停、继续',
};

/** Mounted only inside the open modal, so closing also discards any pending capture. */
function KeybindingSettings() {
  const keymap = useKeymap();
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState('修改后立即保存，仅用于当前浏览器。');
  const editingRef = useRef(null);
  const buttons = useRef({});

  const finish = (message) => {
    editingRef.current = null;
    setEditing(null);
    setStatus(message);
  };
  useLayoutEffect(() => {
    // Keep the consumed key until keyup: Space must not synthesize a button click,
    // and holding Escape after cancellation must not close the containing modal.
    const consumed = new Set();
    const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onKeyDown = (e) => {
      const token = e.code || e.key;
      if (consumed.has(token)) { stop(e); return; }
      const action = editingRef.current;
      if (!action) return;
      if (e.key === 'Tab') { finish('已取消修改。'); return; }
      const code = bindingCodeForEvent(e);
      consumed.add(token);
      stop(e);
      if (e.key === 'Escape' && !e.isComposing) { finish('已取消修改。'); return; }
      if (!code) {
        setStatus('此按键不可用。请单独按 A–Z、0–9 或空格键，不支持组合键、长按或输入法输入。');
        return;
      }
      const previous = keymapStore.get();
      const swapped = KEY_ACTIONS.find((id) => id !== action && previous[id] === code);
      updateKeybinding(action, code);
      finish(swapped
        ? `${KEY_ACTION_LABELS[action]}已设为 ${keyLabel(code)}；${KEY_ACTION_LABELS[swapped]}已自动交换为 ${keyLabel(previous[action])}。`
        : `${KEY_ACTION_LABELS[action]}已设为 ${keyLabel(code)}。`);
    };
    const onKeyUp = (e) => {
      if (!consumed.delete(e.code || e.key)) return;
      stop(e);
    };
    const onPointerDown = (e) => {
      const action = editingRef.current;
      if (action && !buttons.current[action]?.contains(e.target)) finish('已取消修改。');
    };
    const onWindowBlur = () => {
      consumed.clear();
      if (editingRef.current) finish('已取消修改。');
    };
    // Capture runs before Modal's Escape handler and the game's shortcut listener.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, []);

  return html`<section class="set-keys" aria-labelledby="set-keys-title">
    <div class="set-keys__head">
      <h3 id="set-keys-title">快捷键<${MicroLabel}>KEY BINDINGS<//></h3>
      <${Button} size="sm" variant="secondary" class="set-keys__reset" onClick=${() => {
        resetKeybindings(); finish('已恢复默认快捷键。');
      }}>恢复默认<//>
    </div>
    <p id="set-keys-help" class="set-hint">点击按键后，按 A–Z、0–9 或空格键（按键盘位置识别）。占用的按键会自动交换；Esc 或 Tab 取消修改。</p>
    <div class="set-keys__grid">
      ${KEY_ACTIONS.map((action) => html`<div key=${action} class="set-keys__row">
        <span id=${`set-key-label-${action}`}>${KEY_ACTION_LABELS[action]}</span>
        <button type="button" ref=${(el) => { buttons.current[action] = el; }}
          class=${`set-keys__key${editing === action ? ' is-listening' : ''}`} data-key-action=${action}
          aria-label=${`${KEY_ACTION_LABELS[action]}：${editing === action ? '等待按键，Esc 取消' : `${keyLabel(keymap[action])}，点击修改`}`}
          aria-describedby="set-keys-help" aria-pressed=${editing === action ? 'true' : 'false'}
          onBlur=${() => { if (editingRef.current === action) finish('已取消修改。'); }}
          onClick=${() => {
            editingRef.current = action; setEditing(action);
            setStatus(`正在修改${KEY_ACTION_LABELS[action]}：请按新按键，Esc 取消。`);
          }}>${editing === action ? '请按键…' : keyLabel(keymap[action])}</button>
      </div>`)}
    </div>
    <p class="set-keys__status" role="status" aria-live="polite" aria-atomic="true">${status}</p>
  </section>`;
}

/**
 * Settings modal.
 * @param {{ open: boolean, onClose: Function }} props
 */
export function SettingsModal({ open, onClose }) {
  const s = useSettings();
  const [tested, setTested] = useState(false);
  const [touchUi] = useState(() => detectFeatures().coarse && !detectFeatures().fine);
  return html`<${Modal} open=${open} onClose=${onClose} title="设置" micro="SETTINGS" class="set-modal"
    actions=${html`<${Button} variant="secondary" icon="book" class="set-guide" onClick=${() => openGuide(0)}>玩法说明<//>
      <${Button} variant="primary" icon="check" onClick=${onClose}>完成<//>`}>
    <div class="set-list">
      <${Slider} label="背景音乐" micro="BGM" icon="play" value=${s.bgm} onInput=${(v) => updateSettings({ bgm: v })} />
      <${Slider} label="干员语音" micro="VOICE" icon="mic" value=${s.voice} onInput=${(v) => updateSettings({ voice: v })} />
      <${Slider} label="音效" micro="SFX" icon="signal" value=${s.sfx}
        onInput=${(v) => { updateSettings({ sfx: v }); if (!tested) { setTested(true); setTimeout(() => setTested(false), 400); audio.sfx('click'); } }} />
      <${Toggle} label="静音" micro="MUTE" value=${s.muted} onChange=${(v) => updateSettings({ muted: v })} />
      <${Toggle} label="显示伤害数字" micro="DAMAGE NUMBERS" value=${s.damageNumbers} onChange=${(v) => updateSettings({ damageNumbers: v })} />
      <div class="set-row">
        <span class="set-row__label">画面质量<${MicroLabel}>QUALITY<//></span>
        <div class="set-seg" role="radiogroup">
          ${QUALITY.map(([id, label]) => html`<button key=${id} type="button" role="radio" aria-checked=${s.quality === id ? 'true' : 'false'}
            class=${s.quality === id ? 'is-on' : ''} onClick=${() => updateSettings({ quality: id })}>${label}</button>`)}
        </div>
      </div>
      <${KeybindingSettings} />
      <p class="set-hint">${touchUi
        ? '触屏操作：点击单位选中（撤退 / 出售）· 长按单位或卡牌查看详情 · 拖动部署后滑动选择朝向'
        : html`<kbd>Esc</kbd> 关闭弹窗 · 右键查看详情`}</p>
    </div>
  <//>`;
}
