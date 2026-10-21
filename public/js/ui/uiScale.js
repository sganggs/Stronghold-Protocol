// 界面缩放 (设置): one dimensionless factor `--sp-ui` on <html> that resizes the whole interface. The layout root 1rem
// of css/theme.css is clamped at 40 px so CJK browsers never clamp it themselves, but on a phone in landscape under
// 432 px tall that floor overshoots the design by up to a fifth: the HUD and the shop bar run large and the board loses
// the room. The factor scales that root AND the max(… , Npx) touch floors that would otherwise refuse to follow a rem
// (every one of them carries `var(--sp-ui, 1)`), so the result is a uniform change instead of a few stubborn buttons.
//
// 自动 (default): k = fit / 40, k clamped to 0.66…1, where fit = min((w − fit offsets) / 19.2, (h − fit offsets) /
// 10.8) is exactly the design's own 1rem rule (css/theme.css) read in CSS pixels with the browser's visible height, so
// k = 1 on every viewport the design already fits and a desktop never changes. The 75…150 % slider shows the size the
// interface actually ends up with (85 % on a 756×366 phone) and pins it to the chosen percentage once dragged; 自动
// gives the screen back the decision. Kept on this device only (`sp.pref.uiScale`): another device has another screen,
// like 异形屏适配 (ui/screenFit.js, whose edge offsets are part of fit here).

import { html, MicroLabel, Button } from './components.js';
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';
import { fitStore } from './screenFit.js';

/** The slider's range and its step, in percent of the design's own size (100 % = css/theme.css unscaled). */
export const UI_SCALE_MIN_PCT = 75;
export const UI_SCALE_MAX_PCT = 150;
export const UI_SCALE_STEP = 5;
/** 自动 never goes below this: below it the 8 px label floors of the design turn unreadable. */
export const UI_SCALE_MIN = 0.66;
const DESIGN_MIN_ROOT = 40; // css/theme.css's floor — the design's 1rem on any screen (see html { font-size })
// 商店条 (调度中心) shrinks less than the rest: its cards carry the operator names, prices and bond rows a player reads
// at a glance mid-fight, and the bar sits under the thumb — a uniform .85 made it the first thing too small to aim at
// (user playtest, 756×366). `--sp-shop` is the extra ratio (1 … SHOP_BOOST) css/screens/game-shop.css zooms the bar by,
// so the bar lands at min(1, k × SHOP_BOOST) while the rest of the HUD follows k.
const SHOP_BOOST = 1.12;

/**
 * The stored setting: `'auto'` (follow the screen) or a percentage 75…150 snapped to the slider's step. Anything else —
 * a value from an older build, a hand-edited preference — reads as 自动.
 * @param {unknown} v
 * @returns {'auto'|number}
 */
export function sanitizeScale(v) {
  if (v === 'auto' || v == null) return 'auto';
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'auto';
  if (n < 20) return 'auto'; // not a percentage at all
  return Math.min(UI_SCALE_MAX_PCT, Math.max(UI_SCALE_MIN_PCT, Math.round(n / UI_SCALE_STEP) * UI_SCALE_STEP));
}

export const uiScaleStore = createStore({ step: sanitizeScale(loadPref('uiScale', null)) });
/** The chosen step ('auto' by default): the store holds an object (js/store.js createStore spreads its initial state). */
export const getUiScale = () => sanitizeScale(uiScaleStore.get().step);

/**
 * The automatic factor: 1 while the design fits, fit / 40 below that (a 366 CSS px tall phone in landscape ≈ .85),
 * never under UI_SCALE_MIN. `fit` is the design's own 1rem rule: the smaller of 1/19.2 of the width and 1/10.8 of the
 * height, minus the player's 异形屏适配 offsets — the same expression css/theme.css and devices.css use.
 */
export function autoScaleFactor(win = globalThis) {
  const w = Number(win?.innerWidth) - fitSpan('l') - fitSpan('r');
  const h = (Number(win?.visualViewport?.height) || Number(win?.innerHeight)) - fitSpan('t') - fitSpan('b');
  const fit = Math.min(w / 19.2, h / 10.8);
  if (!Number.isFinite(fit) || fit <= 0) return 1;
  return Math.min(1, Math.max(UI_SCALE_MIN, fit / DESIGN_MIN_ROOT));
}

function fitSpan(side) {
  const v = Number(fitStore.get()[side]);
  return Number.isFinite(v) ? v : 0;
}

/** The layout factor of a step on this screen: what css gets and what the settings row shows. */
export function scaleFactor(step = getUiScale(), win = globalThis) {
  const s = sanitizeScale(step);
  return s === 'auto' ? autoScaleFactor(win) : s / 100;
}

/** The size the interface actually ends up with, in percent (what the slider is parked at in 自动). */
export function scalePercent(step = getUiScale(), win = globalThis) {
  return Math.round(scaleFactor(step, win) * 100);
}

let applying = false;

/**
 * The extra ratio css/screens/game-shop.css zooms the shop bar (and its folded tab) by, for a layout factor `k`: 1 while
 * the design fits and `min(SHOP_BOOST, 1 / k)` below it, so the bar's own factor is `min(1, k × SHOP_BOOST)`.
 * @param {number} k
 */
export function shopRatio(k) {
  if (!(k > 0) || k >= 1) return 1;
  return Math.round(Math.min(SHOP_BOOST, 1 / k) * 1000) / 1000;
}

/** Put the factors on <html> (both removed at exactly 100 %: the page is then the design's own). */
export function applyUiScale(step = getUiScale()) {
  const el = globalThis.document?.documentElement;
  if (!el || applying) return;
  const k = Math.round(scaleFactor(step) * 1000) / 1000;
  const shop = shopRatio(k);
  const was = el.style.getPropertyValue('--sp-ui');
  const wasShop = el.style.getPropertyValue('--sp-shop');
  if (k === 1) {
    if (!was && !wasShop) return;
    el.style.removeProperty('--sp-ui');
    el.style.removeProperty('--sp-shop');
  } else {
    if (Number(was) === k && Number(wasShop) === shop) return;
    el.style.setProperty('--sp-ui', String(k));
    if (shop > 1) el.style.setProperty('--sp-shop', String(shop));
    else el.style.removeProperty('--sp-shop');
  }
  // the HUD bands and the shop bar measure the root (ui/fieldHost.js hudBands/hudPadding): tell them the scale moved
  applying = true;
  try { globalThis.dispatchEvent?.(new Event('resize')); } catch { /* old browsers */ }
  finally { applying = false; }
}

uiScaleStore.subscribe((s) => { savePref('uiScale', s.step); applyUiScale(s.step); });
// a rotated phone, a resized window, the browser's toolbars sliding away (visualViewport) or the player's edge offsets
for (const target of [globalThis, globalThis.visualViewport]) {
  target?.addEventListener?.('resize', () => applyUiScale());
  target?.addEventListener?.('orientationchange', () => applyUiScale());
}
fitStore.subscribe(() => applyUiScale());
applyUiScale();

/** @param {'auto'|number} v */
export const setUiScale = (v) => uiScaleStore.set({ step: sanitizeScale(v) });

/** The settings section: 自动 (the screen decides) or a 75…150 % slider pinned by hand. */
export function UiScaleSection() {
  const step = useStore((s) => s.step, Object.is, uiScaleStore);
  const pct = scalePercent(step);
  const auto = step === 'auto';
  const lo = UI_SCALE_MIN_PCT;
  const hi = UI_SCALE_MAX_PCT;
  const fill = `${((pct - lo) / (hi - lo)) * 100}%`;
  const nudge = (d) => setUiScale(Math.min(hi, Math.max(lo, pct + d)));
  return html`<section class="set-uiscale" aria-labelledby="set-uiscale-title" data-testid="ui-scale">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-uiscale-title">${t('界面缩放')}<${MicroLabel}>UI SCALE<//></span>
      <${Button} variant="ghost" size="sm" icon="refresh" class="set-uiscale__reset" disabled=${auto}
        onClick=${() => setUiScale('auto')}>${t('自动')}<//>
    </div>
    <p class="set-hint">${t('屏幕较矮（手机横屏）时界面偏大、按钮和商店挤占棋盘，这里可整体缩放：默认按屏幕自动适配，拖动滑块则固定为所选大小。百分数是界面实际大小（100% 为设计尺寸），棋盘本身按屏幕铺满，不受影响。只保存在这台设备上。')}</p>
    <div class="set-row set-uiscale__row">
      <span class="set-row__label">${t('缩放')}<${MicroLabel}>SCALE<//></span>
      <button type="button" class="set-fit__step" aria-label=${t('减少')} disabled=${pct <= lo} onClick=${() => nudge(-UI_SCALE_STEP)}>−</button>
      <input class="set-range" type="range" min=${lo} max=${hi} step=${UI_SCALE_STEP} value=${pct} style=${`--pct:${fill}`}
        aria-label=${t('界面缩放')} data-testid="ui-scale-range" onInput=${(e) => setUiScale(Number(e.currentTarget.value))} />
      <button type="button" class="set-fit__step" aria-label=${t('增加')} disabled=${pct >= hi} onClick=${() => nudge(UI_SCALE_STEP)}>+</button>
      <span class="set-uiscale__pct num" data-testid="ui-scale-pct">${pct}%</span>
    </div>
  </section>`;
}
