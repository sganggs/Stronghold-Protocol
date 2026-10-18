// 异形屏适配 (设置): on some phones the browser's fullscreen puts the interface under the camera cutout or the curved
// edge, or leaves it off-centre, and reports no safe-area inset for it. This section moves each edge of the interface
// by a number of CSS pixels the player picks while watching it move. Each slider reads 0–100 and starts at 50 =
// unchanged: right of 50 pulls that edge in, left of 50 pushes it out past the reported viewport — 2 CSS px per step,
// ±100 px. Kept on this device only (`sp.pref.screenFit`): another device has another screen.
// Applied on <html>: `data-fit` plus --fit-l / --fit-r / --fit-t / --fit-b; css/devices.css then sets .app-root (the
// screens' fixed box, theme.css) and the full-page panels to that box (every .screen is absolute inset 0 inside it, the
// board is sized from its host element) and computes the layout root 1rem from it instead of the whole viewport. Fixed
// overlays (dialogs, toasts) keep the full screen.

import { html, Button, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { t, N_ } from '../../../shared/i18n.js';

export const FIT_SIDES = ['l', 'r', 't', 'b'];
/** Pixel offset range (inward positive) and the slider scale: value = MID + px / PX_PER_STEP. */
export const FIT_MIN = -100, FIT_MAX = 100, MID = 50, PX_PER_STEP = 2;
const NONE = { l: 0, r: 0, t: 0, b: 0 };

/** A stored value → four whole pixel offsets in FIT_MIN..FIT_MAX (anything else → 0). */
export function sanitizeFit(v) {
  const out = { ...NONE };
  if (v && typeof v === 'object') for (const k of FIT_SIDES) {
    const n = Math.round(Number(v[k]));
    out[k] = Number.isFinite(n) ? Math.min(FIT_MAX, Math.max(FIT_MIN, n)) : 0;
  }
  return out;
}
/** The slider's 0–100 reading of a pixel offset, and back. */
export const sliderOf = (px) => Math.round(MID + px / PX_PER_STEP);
export const pxOf = (v) => (Number(v) - MID) * PX_PER_STEP;

export const fitStore = createStore(sanitizeFit(loadPref('screenFit', null)));

/** Put the offsets on <html> (no attribute while all four are 0: the page is exactly as before). */
export function applyFit(f) {
  const el = globalThis.document?.documentElement;
  if (!el) return;
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
applyFit(fitStore.get());

/** @param {Partial<{l:number,r:number,t:number,b:number}>} patch pixel offsets */
export const updateFit = (patch) => fitStore.set(sanitizeFit({ ...fitStore.get(), ...patch }));

const SIDE_NAMES = { l: N_('左侧'), r: N_('右侧'), t: N_('顶部'), b: N_('底部') };
const SIDE_MICRO = { l: 'LEFT', r: 'RIGHT', t: 'TOP', b: 'BOTTOM' };
const LO = sliderOf(FIT_MIN), HI = sliderOf(FIT_MAX);

/** The settings section: one 0–100 slider per edge (50 = unchanged), −/+ one step for a fine touch, 重置. */
export function ScreenFitSection() {
  const f = useStore((s) => s, Object.is, fitStore);
  const any = FIT_SIDES.some((k) => f[k] !== 0);
  return html`<section class="set-fit" aria-labelledby="set-fit-title" data-testid="screen-fit">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-fit-title">${t('异形屏适配')}<${MicroLabel}>SCREEN FIT<//></span>
      <${Button} variant="ghost" size="sm" icon="refresh" class="set-fit__reset" disabled=${!any} onClick=${() => updateFit(NONE)}>${t('重置')}<//>
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
  </section>`;
}
