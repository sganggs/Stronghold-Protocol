// 异形屏适配 (设置): on some phones the browser's fullscreen puts the interface under the camera cutout or the curved
// edge, or leaves it off-centre, and reports no safe-area inset for it. This section moves each edge of the interface
// by a number of CSS pixels the player picks while watching it move. Each slider reads 0–100 and starts at 50 =
// unchanged: right of 50 pulls that edge in, left of 50 pushes it out past the reported viewport — 2 CSS px per step,
// ±100 px. Kept on this device only (`sp.pref.screenFit`): another device has another screen.
// Applied on <html>: `data-fit` plus --fit-l / --fit-r / --fit-t / --fit-b; css/devices.css then sets .app-root (the
// screens' fixed box, theme.css) and the full-page panels to that box (every .screen is absolute inset 0 inside it, the
// board is sized from its host element) and computes the layout root 1rem from it instead of the whole viewport. Fixed
// overlays (dialogs, toasts) keep the full screen.
//
// 界面大小 (0.3.2, DESIGN §35.43; reworked from PR #838 by @zasx77771): the same section's last row, a manual size of the
// whole interface, 75–100 % in 5 % steps, default 100 % — never automatic, and nothing reads visualViewport (the soft
// keyboard would shrink the UI). Stored with the edges (`ui`, a percentage). Applied as --sp-ui on <html> (only while it is
// not 100 %): theme.css / devices.css multiply the layout root by it, and every max(rem, px) floor in public/css carries
// it — a size floor never below min(its px, 32 px), so touch targets ≥ 32 px stay ≥ 32 px; the text floors (font-size px
// floors, the 文字大小 --t floors of 中 / 大 / 特大) never shrink, while 小's text (1rem, no floor) follows the layout
// (test/ui/ui-size.test.js). Above 100 % is not offered [ASSUMED]: measured on the §35.18 phones it overlaps the
// screens (the hub's 成就统计 under the mode cards at 150 %), and larger text is what 文字大小 is for (DESIGN §35.43).
// Only at 文字大小 小: the kept 64 / 76 / 88 px text floors of 中 and above outgrew their shrinking boxes (clipped labels,
// the merge review of 2026-10-23), so there the row is disabled and the interface stays at 100 % — the stored size is
// kept and applies again at 小 (effectiveUi). While the slider is dragged only its reading follows; the size applies on
// release (`pointerup` or `change`), so the settings modal does not resize the track under the finger. The reading is
// dropped on pointercancel / blur and by −, + and 重置, and ignored once the stored size changes (Chrome fires no
// `change` when a drag ends on its start value; a touch drag can turn into a scroll — DESIGN §35.45).

import { useState } from '../../vendor/hooks.module.js';
import { html, Button, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { settingsStore } from './settingsStore.js';
import { t, N_ } from '../../../shared/i18n.js';

export const FIT_SIDES = ['l', 'r', 't', 'b'];
/** Pixel offset range (inward positive) and the slider scale: value = MID + px / PX_PER_STEP. */
export const FIT_MIN = -100, FIT_MAX = 100, MID = 50, PX_PER_STEP = 2;
/** 界面大小: percent of the design's size — the slider's range and step ([ASSUMED], DESIGN §35.43). */
export const UI_MIN = 75, UI_MAX = 100, UI_STEP = 5;
const NONE = { l: 0, r: 0, t: 0, b: 0, ui: 100 };

/** A percentage → UI_MIN..UI_MAX snapped to UI_STEP (anything else, or a value stored before 0.3.2: 100). */
export function sanitizeUi(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 100;
  return Math.min(UI_MAX, Math.max(UI_MIN, Math.round(n / UI_STEP) * UI_STEP));
}

/** A stored value → four whole pixel offsets in FIT_MIN..FIT_MAX (anything else → 0) and the size `ui` (sanitizeUi). */
export function sanitizeFit(v) {
  const out = { ...NONE };
  if (v && typeof v === 'object') {
    for (const k of FIT_SIDES) {
      const n = Math.round(Number(v[k]));
      out[k] = Number.isFinite(n) ? Math.min(FIT_MAX, Math.max(FIT_MIN, n)) : 0;
    }
    out.ui = sanitizeUi(v.ui);
  }
  return out;
}
/** The slider's 0–100 reading of a pixel offset, and back. */
export const sliderOf = (px) => Math.round(MID + px / PX_PER_STEP);
export const pxOf = (v) => (Number(v) - MID) * PX_PER_STEP;

export const fitStore = createStore(sanitizeFit(loadPref('screenFit', null)));

/** 界面大小 applies at 文字大小 小 only (see the header); `textSize` missing = 小. */
export const uiAllowed = (textSize) => textSize == null || textSize === 'sm';
/** The size on screen: the stored one at 小, 100 at 中 and above. */
export const effectiveUi = (ui, textSize) => (uiAllowed(textSize) ? sanitizeUi(ui) : 100);

/** Put the offsets and the size on <html> (no attribute while all four are 0, no --sp-ui at 100 %: the page as before). */
export function applyFit(f, textSize = settingsStore.get().textSize) {
  const el = globalThis.document?.documentElement;
  if (!el) return;
  const ui = effectiveUi(f.ui, textSize);
  if (ui !== 100) el.style.setProperty('--sp-ui', String(ui / 100));
  else el.style.removeProperty('--sp-ui');
  const on = FIT_SIDES.some((k) => f[k] !== 0);
  if (on) {
    el.dataset.fit = '';
    for (const k of FIT_SIDES) el.style.setProperty(`--fit-${k}`, `${f[k]}px`);
  } else {
    delete el.dataset.fit;
    for (const k of FIT_SIDES) el.style.removeProperty(`--fit-${k}`);
  }
  // the board and the HUD measure their host on resize (render/app.js, ui/fieldHost.js)
  try { globalThis.dispatchEvent?.(new Event('resize')); } catch { /* old browsers */ }
}

fitStore.subscribe((f) => { savePref('screenFit', f); applyFit(f); });
// a 文字大小 change turns the stored size on (小) or off (中 and above)
let appliedText = settingsStore.get().textSize;
settingsStore.subscribe((s) => { if (s.textSize !== appliedText) { appliedText = s.textSize; applyFit(fitStore.get(), s.textSize); } });
applyFit(fitStore.get());

/** @param {Partial<{l:number,r:number,t:number,b:number,ui:number}>} patch pixel offsets, the size in percent */
export const updateFit = (patch) => fitStore.set(sanitizeFit({ ...fitStore.get(), ...patch }));

const SIDE_NAMES = { l: N_('左侧'), r: N_('右侧'), t: N_('顶部'), b: N_('底部') };
const SIDE_MICRO = { l: 'LEFT', r: 'RIGHT', t: 'TOP', b: 'BOTTOM' };
const LO = sliderOf(FIT_MIN), HI = sliderOf(FIT_MAX);

/** The settings section: one 0–100 slider per edge (50 = unchanged), −/+ one step for a fine touch, 界面大小, 重置. */
export function ScreenFitSection() {
  const f = useStore((s) => s, Object.is, fitStore);
  const textSize = useStore((s) => s.textSize, Object.is, settingsStore);
  // a drag's reading ({ v, from }: the value and the stored size it was taken from). The release applies it; Chrome
  // fires no `change` when a drag ends where it began, and a touch drag can turn into a scroll, so the reading is
  // also dropped on pointercancel / blur and by −, + and 重置, and ignored once the stored size is another one.
  const [preview, setPreview] = useState(null);
  const ui = sanitizeUi(f.ui);
  const allowed = uiAllowed(textSize);
  const shown = allowed ? sanitizeUi(preview && preview.from === ui ? preview.v : ui) : 100;
  // applies only a new size: a plain click on the thumb, or the `change` after a `pointerup` that already applied it,
  // stores nothing and re-measures nothing (applyFit sends a window resize). Nothing at all while the row is disabled:
  // Chrome still sends pointerup to a disabled range, whose value is the shown 100, and the stored size must survive
  // 中 and above (DESIGN §35.47).
  const setUi = (v) => { setPreview(null); if (allowed && sanitizeUi(v) !== ui) updateFit({ ui: Number(v) }); };
  const any = FIT_SIDES.some((k) => f[k] !== 0) || ui !== 100;
  return html`<section class="set-fit" aria-labelledby="set-fit-title" data-testid="screen-fit">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-fit-title">${t('异形屏适配')}<${MicroLabel}>SCREEN FIT<//></span>
      <${Button} variant="ghost" size="sm" icon="refresh" class="set-fit__reset" disabled=${!any} onClick=${() => { setPreview(null); updateFit(NONE); }}>${t('重置')}<//>
    </div>
    <p class="set-hint">${t('全屏后界面被挖孔、刘海或曲面边缘挡住，或比例、位置不对时使用：50 为不调整，往右拉该边往里收，往左拉该边往外扩。界面会立即移动，可边看边调，只保存在这台设备上。')}</p>
    ${FIT_SIDES.map((k) => {
      const v = sliderOf(f[k]);
      return html`<div key=${k} class="set-row set-fit__row">
        <span class="set-row__label">${t(SIDE_NAMES[k])}<${MicroLabel}>${SIDE_MICRO[k]}<//></span>
        <button type="button" class="set-fit__step" aria-label=${t('减少')} disabled=${v <= LO} onClick=${() => updateFit({ [k]: pxOf(v - 1) })}>−</button>
        <input class="set-range" type="range" min=${LO} max=${HI} step="1" value=${v} style=${`--pct:${v}%`}
          aria-label=${t(SIDE_NAMES[k])} data-testid=${`fit-${k}`} onInput=${(e) => updateFit({ [k]: pxOf(e.currentTarget.value) })} />
        <button type="button" class="set-fit__step" aria-label=${t('增加')} disabled=${v >= HI} onClick=${() => updateFit({ [k]: pxOf(v + 1) })}>+</button>
        <span class="set-row__val num">${v}</span>
      </div>`;
    })}
    <div class=${`set-row set-fit__row${allowed ? '' : ' is-disabled'}`} data-testid="ui-size">
      <span class="set-row__label">${t('界面大小')}<${MicroLabel}>UI SIZE<//></span>
      <button type="button" class="set-fit__step" aria-label=${t('减少')} disabled=${!allowed || ui <= UI_MIN} onClick=${() => setUi(ui - UI_STEP)}>−</button>
      <input class="set-range" type="range" min=${UI_MIN} max=${UI_MAX} step=${UI_STEP} value=${shown} disabled=${!allowed}
        style=${`--pct:${((shown - UI_MIN) / (UI_MAX - UI_MIN)) * 100}%`} aria-label=${t('界面大小')} data-testid="ui-size-range"
        onInput=${(e) => setPreview({ v: Number(e.currentTarget.value), from: ui })}
        onPointerUp=${(e) => setUi(e.currentTarget.value)} onChange=${(e) => setUi(e.currentTarget.value)}
        onPointerCancel=${() => setPreview(null)} onBlur=${() => setPreview(null)} />
      <button type="button" class="set-fit__step" aria-label=${t('增加')} disabled=${!allowed || ui >= UI_MAX} onClick=${() => setUi(ui + UI_STEP)}>+</button>
      <span class="set-row__val num" data-testid="ui-size-pct">${shown}%</span>
    </div>
    <p class="set-hint">${t('界面大小：缩小按钮、面板、商店条和文字，给棋盘多留空间（100% 为原尺寸）；按钮保持可点的大小。')}</p>
    ${allowed ? null : html`<p class="set-hint" data-testid="ui-size-locked">${t('文字大小为「中」及以上时不可缩小界面')}</p>`}
  </section>`;
}
