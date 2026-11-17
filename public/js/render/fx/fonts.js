// public/js/render/fx/fonts.js — damage-number bitmap fonts (one module-level ready flag).

import { DMG_STYLE } from '../style.js';

let fontsReady = false;

/** Generate the damage-number bitmap fonts (after web fonts loaded, if possible). */
export function ensureDamageFonts() {
  if (fontsReady) return;
  const P = globalThis.PIXI;
  for (const st of Object.values(DMG_STYLE)) {
    try {
      P.BitmapFont.from(st.font, {
        fontFamily: ['Bender', 'Oxanium', 'Rajdhani', 'Arial Black', 'sans-serif'], fontSize: 44, fontWeight: '700',
        fill: st.fill, fillGradientStops: [0.25, 1], stroke: st.stroke, strokeThickness: 7,
        dropShadow: true, dropShadowColor: '#000000', dropShadowAlpha: 0.45, dropShadowDistance: 2, dropShadowBlur: 2,
      }, { chars: [['0', '9'], '+-−×!. COSTPMI'], resolution: 2, padding: 6 });
    } catch (err) { console.warn('[fx] bitmap font', st.font, err?.message || err); }
  }
  fontsReady = true;
}
